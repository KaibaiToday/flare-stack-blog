import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import {
  fetchPost,
  invalidatePostCaches,
  upsertPostSearchIndex,
} from "@/features/posts/workflows/helpers";

interface Params {
  postId: number;
  publishedAt: string; // ISO 8601
}

export class ScheduledPublishWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { postId } = event.payload;

    const publishAt = new Date(event.payload.publishedAt);
    if (Number.isNaN(publishAt.getTime())) return;

    await step.sleepUntil(
      "sleep until publish date",
      publishAt,
    );

    const post = await step.do("verify post status", async () => {
      return await fetchPost(this.env, postId);
    });

    if (!post || post.status !== "published") return;

    await step.do("invalidate caches", async () => {
      await invalidatePostCaches(this.env, post.slug);
    });

    await step.do("update search index", async () => {
      await upsertPostSearchIndex(this.env, post);
    });
  }
}
