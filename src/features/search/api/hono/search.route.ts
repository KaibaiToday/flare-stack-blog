import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { baseMiddleware, rateLimitMiddleware } from "@/lib/hono/middlewares";
import {
  createRateLimiterIdentifier,
  setCacheHeaders,
} from "@/lib/hono/helper";
import { SearchQuerySchema } from "@/features/search/search.schema";
import * as SearchService from "@/features/search/search.service";

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
    SearchQuerySchema.extend({
      limit: z.coerce.number().optional().default(10),
    }),
  ),
  async (c) => {
    const data = c.req.valid("query");
    const result = await SearchService.search(
      { db: c.get("db"), env: c.env },
      data,
    );
    setCacheHeaders(c.res.headers, "immutable");
    return c.json(result);
  },
);

export default route;
