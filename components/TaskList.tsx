"use client";

export type TaskStatus = "pending" | "in_progress" | "done";

export interface Task {
  title: string;
  status: TaskStatus;
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <svg
          viewBox="0 0 20 20"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 10l4 4 8-8" />
        </svg>
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="flex h-4 w-4 flex-none items-center justify-center">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 flex-none items-center justify-center">
      <span className="h-2.5 w-2.5 rounded-full border border-zinc-600" />
    </span>
  );
}

export default function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;

  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Tasks
        </span>
        <span className="text-[10px] font-medium text-zinc-500">
          {doneCount}/{tasks.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((task, index) => (
          <li key={index} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5">
              <StatusIcon status={task.status} />
            </span>
            <span
              className={
                task.status === "done"
                  ? "text-zinc-500 line-through"
                  : task.status === "in_progress"
                    ? "text-zinc-100"
                    : "text-zinc-400"
              }
            >
              {task.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
