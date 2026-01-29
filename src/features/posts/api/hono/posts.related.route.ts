import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { baseMiddleware, rateLimitMiddleware } from "@/lib/hono/middlewares";
import {
  createRateLimiterIdentifier,
  getServiceContext,
  setCacheHeaders,
} from "@/lib/hono/helper";
import * as PostService from "@/features/posts/posts.service";

const app = new Hono<{ Bindings: Env }>();

app.use("*", baseMiddleware);

const route = app.get(
  "/:slug/related",
  rateLimitMiddleware({
    capacity: 60,
    interval: "1m",
    identifier: createRateLimiterIdentifier,
  }),
  zValidator("param", z.object({ slug: z.string() })),
  zValidator("query", z.object({ limit: z.coerce.number().optional() })),
  async (c) => {
    const { slug } = c.req.valid("param");
    const { limit } = c.req.valid("query");
    const result = await PostService.getRelatedPosts(getServiceContext(c), {
      slug,
      limit,
    });
    setCacheHeaders(c.res.headers, "public");
    return c.json(result);
  },
);

export default route;
