import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { User } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommentStatus } from "@/lib/db/schema";
import { CommentModerationTable } from "@/features/comments/components/admin/comment-moderation-table";
import { Input } from "@/components/ui/input";

const searchSchema = z.object({
  status: z
    .enum(["pending", "published", "deleted", "verifying", "ALL"])
    .optional()
    .default("pending")
    .catch("pending"),
  userName: z.string().optional(),
  page: z.number().optional().default(1).catch(1),
});

export const Route = createFileRoute("/admin/appearance/")({
  validateSearch: searchSchema,
  component: AppearancePage,
  loader: () => {
    return {
      title: "外观设置",
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.title,
      },
    ],
  }),
});

function AppearancePage() {
  const { status, userName, page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [searchInput, setSearchInput] = useState(userName || "");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== userName) {
        navigate({
          search: (prev) => ({
            ...prev,
            userName: searchInput || undefined,
            page: 1, // Reset page on search
          }),
        });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchInput, navigate, userName]);

  return (
    <div className="space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8 border-b border-border/30 pb-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-serif font-medium tracking-tight text-foreground">
            外观设置
          </h1>
          <div className="flex items-center gap-2">
            <p className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
              Appearance
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* Navigation & Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        </div>

        
      </div>
    </div>
  );
}
