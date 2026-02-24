import { z } from "zod";
import type {
  DeletePostInput,
  FindPostByIdInput,
  FindPostBySlugInput,
  FindRelatedPostsInput,
  GenerateSlugInput,
  GetPostsCountInput,
  GetPostsCursorInput,
  GetPostsInput,
  PreviewSummaryInput,
  StartPostProcessInput,
  UpdatePostInput,
} from "@/features/posts/posts.schema";
import * as CacheService from "@/features/cache/cache.service";
import { isFuturePublishDate } from "@/features/posts/utils/date";
import { syncPostMedia } from "@/features/posts/data/post-media.data";
import * as PostRepo from "@/features/posts/data/posts.data";
import {
  POSTS_CACHE_KEYS,
  PostListResponseSchema,
  PostWithTocSchema,
} from "@/features/posts/posts.schema";
import * as AiService from "@/features/ai/ai.service";
import { generateTableOfContents } from "@/features/posts/utils/toc";
import { convertToPlainText, slugify } from "@/features/posts/utils/content";
import { purgePostCDNCache } from "@/lib/invalidate";
import * as SearchService from "@/features/search/search.service";
import { calculatePostHash } from "@/features/posts/utils/sync";
import { getCurrentMinuteEnd } from "@/lib/utils";

/**
 * 获取公开文章的游标分页结果。
 * 使用版本化缓存 key，支持按标签过滤的列表缓存失效。
 */
export async function getPostsCursor(
  context: DbContext & { executionCtx: ExecutionContext },
  data: GetPostsCursorInput,
) {
  // 游标分页查询：对外只返回公开文章
  const fetcher = async () =>
    await PostRepo.getPostsCursor(context.db, {
      cursor: data.cursor,
      limit: data.limit,
      publicOnly: true,
      tagName: data.tagName,
    });

  // 列表缓存使用版本号做“逻辑失效”，避免逐条删 key
  const version = await CacheService.getVersion(context, "posts:list");
  const cacheKey = POSTS_CACHE_KEYS.list(
    version,
    data.limit ?? 10,
    data.cursor ?? 0,
    data.tagName ?? "all",
  );

  return await CacheService.get(
    context,
    cacheKey,
    PostListResponseSchema,
    fetcher,
    {
      ttl: "7d",
    },
  );
}

/**
 * 按 slug 获取公开文章详情（含目录 toc）。
 * 读取时对内容做代码高亮，并走详情缓存。
 */
export async function findPostBySlug(
  context: DbContext & { executionCtx: ExecutionContext },
  data: FindPostBySlugInput,
) {
  const fetcher = async () => {
    // 公开接口只允许读取已发布文章
    const post = await PostRepo.findPostBySlug(context.db, data.slug, {
      publicOnly: true,
    });
    if (!post) return null;

    let contentJson = post.contentJson;
    if (contentJson) {
      // 命中详情时动态进行代码高亮，避免写库时引入重计算
      const { highlightCodeBlocks } =
        await import("@/features/posts/utils/content");
      contentJson = await highlightCodeBlocks(contentJson);
    }

    return {
      ...post,
      contentJson,
      toc: generateTableOfContents(post.contentJson),
    };
  };

  const version = await CacheService.getVersion(context, "posts:detail");
  const cacheKey = POSTS_CACHE_KEYS.detail(version, data.slug);
  return await CacheService.get(context, cacheKey, PostWithTocSchema, fetcher, {
    ttl: "7d",
  });
}

/**
 * 获取相关文章：先缓存候选 ID，再实时回填可见文章数据。
 * 通过二段式查询兼顾命中率与数据新鲜度。
 */
export async function getRelatedPosts(
  context: DbContext & { executionCtx: ExecutionContext },
  data: FindRelatedPostsInput,
) {
  const fetcher = async () => {
    const postIds = await PostRepo.getRelatedPostIds(context.db, data.slug, {
      limit: data.limit,
    });
    return postIds;
  };

  // 先缓存“相关文章 ID 列表”（7 天），这是较稳定的长缓存
  // 该 key 不依赖版本号，发布后也可复用
  const cacheKey = POSTS_CACHE_KEYS.related(data.slug, data.limit);
  const cachedIds = await CacheService.get(
    context,
    cacheKey,
    z.array(z.number()),
    fetcher,
    {
      ttl: "7d",
    },
  );

  if (cachedIds.length === 0) {
    return [];
  }

  // 实时回填文章数据：自动过滤掉未发布/不可见文章
  const posts = await PostRepo.getPublicPostsByIds(context.db, cachedIds);

  // SQL IN 查询不保证顺序，这里按缓存 ID 顺序恢复
  const orderedPosts = cachedIds
    .map((id) => posts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  return orderedPosts;
}

/**
 * 为指定文章生成 AI 摘要。
 * 仅在摘要为空且正文足够长时触发生成。
 */
export async function generateSummaryByPostId({
  context,
  postId,
}: {
  context: DbContext;
  postId: number;
}) {
  const post = await PostRepo.findPostById(context.db, postId);

  if (!post) {
    throw new Error("Post not found");
  }

  // 如果已经存在摘要，则直接返回
  if (post.summary && post.summary.trim().length > 0) return post;

  const plainText = convertToPlainText(post.contentJson);
  if (plainText.length < 100) {
    return post;
  }

  const { summary } = await AiService.summarizeText(context, plainText);

  const updatedPost = await PostRepo.updatePost(context.db, post.id, {
    summary,
  });

  return updatedPost;
}

// ============ Admin Service Methods ============

/**
 * 基于标题生成唯一 slug。
 * 若基础 slug 被占用，按最大数字后缀递增。
 */
export async function generateSlug(
  context: DbContext,
  data: GenerateSlugInput,
) {
  const baseSlug = slugify(data.title);
  // 1. 先查有没有完全一样的 (比如 'hello-world')
  const exactMatch = await PostRepo.slugExists(context.db, baseSlug, {
    excludeId: data.excludeId,
  });
  if (!exactMatch) {
    return { slug: baseSlug };
  }

  // 2. 既然 'hello-world' 被占了，那就查所有 'hello-world-%' 的
  const similarSlugs = await PostRepo.findSimilarSlugs(context.db, baseSlug, {
    excludeId: data.excludeId,
  });

  // 3. 在内存里找最大的数字后缀
  // 正则含义：匹配以 "-数字" 结尾的字符串，并捕获那个数字
  const regex = new RegExp(`^${baseSlug}-(\\d+)$`);

  let maxSuffix = 0;
  for (const slug of similarSlugs) {
    const match = slug.match(regex);
    if (match) {
      const number = parseInt(match[1], 10);
      if (number > maxSuffix) {
        maxSuffix = number;
      }
    }
  }

  // 4. 结果就是最大值 + 1
  return { slug: `${baseSlug}-${maxSuffix + 1}` };
}

export async function createEmptyPost(context: DbContext) {
  const { slug } = await generateSlug(context, { title: "" });

  const post = await PostRepo.insertPost(context.db, {
    title: "",
    slug,
    summary: "",
    status: "draft",
    readTimeInMinutes: 1,
    contentJson: null,
  });

  // 草稿不进入公共缓存与搜索索引

  return { id: post.id };
}

export async function getPosts(context: DbContext, data: GetPostsInput) {
  return await PostRepo.getPosts(context.db, {
    offset: data.offset ?? 0,
    limit: data.limit ?? 10,
    status: data.status,
    publicOnly: data.publicOnly,
    search: data.search,
    sortDir: data.sortDir,
    sortBy: data.sortBy,
  });
}

export async function getPostsCount(
  context: DbContext,
  data: GetPostsCountInput,
) {
  return await PostRepo.getPostsCount(context.db, {
    status: data.status,
    publicOnly: data.publicOnly,
    search: data.search,
  });
}

export async function findPostBySlugAdmin(
  context: DbContext,
  data: FindPostBySlugInput,
) {
  const post = await PostRepo.findPostBySlug(context.db, data.slug, {
    publicOnly: false,
  });
  if (!post) return null;
  return {
    ...post,
    toc: generateTableOfContents(post.contentJson),
  };
}

/**
 * 按文章 ID 获取后台详情，并返回同步状态。
 * isSynced 用于判断数据库内容与公共缓存（KV 哈希）是否一致。
 */
export async function findPostById(
  context: DbContext,
  data: FindPostByIdInput,
) {
  const post = await PostRepo.findPostById(context.db, data.id);
  if (!post) return null;

  const kvHash = await CacheService.getRaw(
    context,
    POSTS_CACHE_KEYS.syncHash(post.id),
  );
  // 是否存在“对外可见版本”的同步哈希
  const hasPublicCache = kvHash !== null;

  let isSynced: boolean;
  if (post.status === "draft") {
    // 草稿：同步 = KV 中没有旧缓存
    isSynced = !hasPublicCache;
  } else {
    // 已发布：用内容哈希判断数据库与公共缓存是否一致
    const dbHash = await calculatePostHash({
      title: post.title,
      contentJson: post.contentJson,
      summary: post.summary,
      tagIds: post.tags.map((t) => t.id),
      slug: post.slug,
      publishedAt: post.publishedAt,
      readTimeInMinutes: post.readTimeInMinutes,
    });
    isSynced = dbHash === kvHash;
  }

  return { ...post, isSynced, hasPublicCache };
}

/**
 * 更新文章并返回最新详情。
 * 当正文变更时异步同步媒体引用关系。
 */
export async function updatePost(
  context: DbContext & { executionCtx: ExecutionContext; env?: Env },
  data: UpdatePostInput,
) {
  const updatedPost = await PostRepo.updatePost(context.db, data.id, data.data);
  if (!updatedPost) {
    throw new Error("Post not found");
  }

  if (data.data.contentJson !== undefined) {
    // 内容变化后异步同步媒体引用关系，不阻塞主请求
    context.executionCtx.waitUntil(
      syncPostMedia(context.db, updatedPost.id, data.data.contentJson),
    );
  }

  return findPostById(context, { id: updatedPost.id });
}

/**
 * 删除文章。
 * 若为已发布文章，同时异步清理详情缓存、列表版本、搜索索引与 CDN。
 */
export async function deletePost(
  context: DbContext & { executionCtx: ExecutionContext },
  data: DeletePostInput,
) {
  const post = await PostRepo.findPostById(context.db, data.id);
  if (!post) return;

  await PostRepo.deletePost(context.db, data.id);

  // 仅已发布文章需要清理公共缓存、搜索索引与 CDN
  if (post.status === "published") {
    const tasks = [];
    const version = await CacheService.getVersion(context, "posts:detail");
    tasks.push(
      CacheService.deleteKey(
        context,
        POSTS_CACHE_KEYS.detail(version, post.slug),
      ),
    );
    tasks.push(CacheService.bumpVersion(context, "posts:list"));
    tasks.push(SearchService.deleteIndex(context, { id: data.id }));
    tasks.push(purgePostCDNCache(context.env, post.slug));
    tasks.push(
      CacheService.deleteKey(context, POSTS_CACHE_KEYS.syncHash(data.id)),
    );

    context.executionCtx.waitUntil(Promise.all(tasks));
  } else {
    // 草稿也要清理同步哈希（若存在）
    context.executionCtx.waitUntil(
      CacheService.deleteKey(context, POSTS_CACHE_KEYS.syncHash(data.id)),
    );
  }
}

export async function previewSummary(
  context: DbContext,
  data: PreviewSummaryInput,
) {
  const plainText = convertToPlainText(data.contentJson);
  const { summary } = await AiService.summarizeText(context, plainText);
  return { summary };
}

/**
 * 启动文章发布后处理工作流。
 * 负责补齐发布时间、触发后处理，以及维护定时发布实例。
 */
export async function startPostProcessWorkflow(
  context: DbContext,
  data: StartPostProcessInput,
) {
  let publishedAtISO: string | undefined;

  // 若状态改为 published 且未设置发布时间，则自动补齐当前时间
  if (data.status === "published") {
    const post = await PostRepo.findPostById(context.db, data.id);
    if (post && !post.publishedAt) {
      const now = getCurrentMinuteEnd();
      await PostRepo.updatePost(context.db, post.id, {
        publishedAt: now,
      });
      publishedAtISO = now.toISOString();
    } else if (post?.publishedAt) {
      publishedAtISO = post.publishedAt.toISOString();
    }
  }

  const isFuture =
    !!publishedAtISO && isFuturePublishDate(publishedAtISO, data.clientToday);

  await context.env.POST_PROCESS_WORKFLOW.create({
    params: {
      postId: data.id,
      isPublished: data.status === "published",
      publishedAt: publishedAtISO,
      isFuturePost: isFuture,
    },
  });

  // 防御性处理：先终止该文章已有的定时发布实例，避免重复触发
  const scheduledId = `post-${data.id}-scheduled`;
  try {
    const oldInstance =
      await context.env.SCHEDULED_PUBLISH_WORKFLOW.get(scheduledId);
    await oldInstance.terminate();
  } catch {
    // 实例不存在或已完成，忽略即可
  }

  // 如果发布时间在未来，则创建新的定时发布工作流
  if (data.status === "published" && publishedAtISO) {
    const publishDate = new Date(publishedAtISO);
    if (publishDate.getTime() > Date.now()) {
      await context.env.SCHEDULED_PUBLISH_WORKFLOW.create({
        id: scheduledId,
        params: { postId: data.id, publishedAt: publishedAtISO },
      });
    }
  }
}
