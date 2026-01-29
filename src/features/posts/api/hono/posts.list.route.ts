import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { baseMiddleware, rateLimitMiddleware } from "@/lib/hono/middlewares";
import {
  createRateLimiterIdentifier,
  getServiceContext,
  setCacheHeaders,
} from "@/lib/hono/helper";
import { GetPostsCursorInputSchema } from "@/features/posts/posts.schema";
import * as PostService from "@/features/posts/posts.service";

const app = new Hono<{ Bindings: Env }>();

app.use("*", baseMiddleware);

const route = app.get(
  "/",
  rateLimitMiddleware({
    capacity: 30,
    interval: "1m",
    identifier: createRateLimiterIdentifier,
  }),
  zValidator(
    "query",
    GetPostsCursorInputSchema.extend({
      cursor: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }),
  ),
  async (c) => {
    const data = c.req.valid("query");
    const result = await PostService.getPostsCursor(getServiceContext(c), data);
    setCacheHeaders(c.res.headers, "public");
    return c.json(result);
  },
);

export default route;
