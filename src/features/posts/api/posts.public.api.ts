import { createServerFn } from "@tanstack/react-start";
import {
  FindPostBySlugInputSchema,
  FindRelatedPostsInputSchema,
  GetPostsCursorInputSchema,
} from "@/features/posts/posts.schema";
import * as PostService from "@/features/posts/posts.service";
import { createRateLimitMiddleware } from "@/lib/middlewares";

export const getPostsCursorFn = createServerFn()
  .middleware([
    createRateLimitMiddleware({
      capacity: 30,
      interval: "1m",
      key: "posts:getCursor",
    }),
  ])
  .inputValidator(GetPostsCursorInputSchema)
  .handler(async ({ data, context }) => {
    return await PostService.getPostsCursor(context, data);
  });

export const findPostBySlugFn = createServerFn()
  .middleware([
    createRateLimitMiddleware({
      capacity: 30,
      interval: "1m",
      key: "posts:findBySlug",
    }),
  ])
  .inputValidator(FindPostBySlugInputSchema)
  .handler(async ({ data, context }) => {
    return await PostService.findPostBySlug(context, data);
  });

export const getRelatedPostsFn = createServerFn()
  .middleware([
    createRateLimitMiddleware({
      capacity: 60,
      interval: "1m",
      key: "posts:getRelated",
    }),
  ])
  .inputValidator(FindRelatedPostsInputSchema)
  .handler(async ({ data, context }) => {
    return await PostService.getRelatedPosts(context, data);
  });
