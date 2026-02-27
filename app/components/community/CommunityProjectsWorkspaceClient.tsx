"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type RoomRecord = {
  id: string;
  title: string;
  status: string;
};

type ProjectLinkRecord = {
  id: string;
  projectId: string;
  roomId: string;
  role: "owner" | "editor" | "viewer";
  linkedByUserId: string;
  createdAt: string;
};

type ProjectTaskKind = "transcription" | "translation" | "notation" | "article" | "multitrack" | "other";
type ProjectTaskStatus = "todo" | "in_progress" | "done";

type ProjectTaskRecord = {
  id: string;
  projectId: string;
  title: string;
  kind: ProjectTaskKind;
  status: ProjectTaskStatus;
  assigneeUserId?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type ProjectTimelineEventRecord = {
  id: string;
  projectId: string;
  type: "PROJECT_CREATED" | "ROOM_LINKED" | "ROOM_LINK_UPDATED" | "TASK_CREATED" | "TASK_UPDATED";
  actorUserId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type RoomsListResponse = {
  items?: RoomRecord[];
};

type ProjectsListResponse = {
  items?: ProjectRecord[];
};

type ProjectLinksResponse = {
  items?: ProjectLinkRecord[];
};

type ProjectTasksResponse = {
  items?: ProjectTaskRecord[];
};

type ProjectTimelineResponse = {
  items?: ProjectTimelineEventRecord[];
};

function withHttpStatus(template: string, status: number): string {
  return template.replace("{status}", String(status));
}

function withRole(template: string, role: string): string {
  return template.replace("{role}", role);
}

function withActor(template: string, userId: string): string {
  return template.replace("{userId}", userId);
}

function withKind(template: string, kind: string): string {
  return template.replace("{kind}", kind);
}

function withStatus(template: string, status: string): string {
  return template.replace("{status}", status);
}

function withTaskId(template: string, taskId: string): string {
  return template.replace("{taskId}", taskId);
}

function withRoomId(template: string, roomId: string): string {
  return template.replace("{roomId}", roomId);
}

const TASK_KIND_ORDER: ProjectTaskKind[] = ["transcription", "translation", "notation", "article", "multitrack", "other"];
const TASK_STATUS_ORDER: ProjectTaskStatus[] = ["todo", "in_progress", "done"];

export function CommunityProjectsWorkspaceClient() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [links, setLinks] = useState<ProjectLinkRecord[]>([]);
  const [tasks, setTasks] = useState<ProjectTaskRecord[]>([]);
  const [timeline, setTimeline] = useState<ProjectTimelineEventRecord[]>([]);
  const [status, setStatus] = useState(t("community.projects.statusLoadingWorkspace"));

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskKind, setNewTaskKind] = useState<ProjectTaskKind>("other");

  const [activeProjectId, setActiveProjectId] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedRole, setSelectedRole] = useState<"owner" | "editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);

  const roomById = useMemo(() => {
    const map = new Map<string, RoomRecord>();
    for (const item of rooms) map.set(item.id, item);
    return map;
  }, [rooms]);

  const taskKindLabel = useCallback(
    (kind: ProjectTaskKind) => {
      if (kind === "transcription") return t("community.projects.taskKind.transcription");
      if (kind === "translation") return t("community.projects.taskKind.translation");
      if (kind === "notation") return t("community.projects.taskKind.notation");
      if (kind === "article") return t("community.projects.taskKind.article");
      if (kind === "multitrack") return t("community.projects.taskKind.multitrack");
      return t("community.projects.taskKind.other");
    },
    [t]
  );

  const taskStatusLabel = useCallback(
    (statusValue: ProjectTaskStatus) => {
      if (statusValue === "todo") return t("community.projects.taskStatus.todo");
      if (statusValue === "in_progress") return t("community.projects.taskStatus.in_progress");
      return t("community.projects.taskStatus.done");
    },
    [t]
  );

  const timelineTypeLabel = useCallback(
    (type: ProjectTimelineEventRecord["type"]) => {
      if (type === "PROJECT_CREATED") return t("community.projects.timelineType.PROJECT_CREATED");
      if (type === "ROOM_LINKED") return t("community.projects.timelineType.ROOM_LINKED");
      if (type === "ROOM_LINK_UPDATED") return t("community.projects.timelineType.ROOM_LINK_UPDATED");
      if (type === "TASK_CREATED") return t("community.projects.timelineType.TASK_CREATED");
      return t("community.projects.timelineType.TASK_UPDATED");
    },
    [t]
  );

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/community/projects?mine=1&offset=0&limit=100", { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401) {
        setStatus(t("community.projects.statusAuthRequired"));
        setProjects([]);
        return;
      }
      setStatus(t("community.projects.statusLoadProjectsFailed"));
      return;
    }
    const payload = (await response.json()) as ProjectsListResponse;
    const nextProjects = payload.items || [];
    setProjects(nextProjects);
    if (!activeProjectId && nextProjects[0]?.id) {
      setActiveProjectId(nextProjects[0].id);
    }
  }, [activeProjectId, t]);

  const loadRooms = useCallback(async () => {
    const response = await fetch("/api/community/rooms?offset=0&limit=100", { cache: "no-store" });
    if (!response.ok) {
      setRooms([]);
      return;
    }
    const payload = (await response.json()) as RoomsListResponse;
    setRooms(payload.items || []);
  }, []);

  const loadLinks = useCallback(async (projectId: string) => {
    if (!projectId) {
      setLinks([]);
      return;
    }
    const response = await fetch(`/api/community/projects/${encodeURIComponent(projectId)}/rooms`, { cache: "no-store" });
    if (!response.ok) {
      setLinks([]);
      return;
    }
    const payload = (await response.json()) as ProjectLinksResponse;
    setLinks(payload.items || []);
  }, []);

  const loadTasksAndTimeline = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setTasks([]);
        setTimeline([]);
        return;
      }
      const [tasksResponse, timelineResponse] = await Promise.all([
        fetch(`/api/community/projects/${encodeURIComponent(projectId)}/tasks`, { cache: "no-store" }),
        fetch(`/api/community/projects/${encodeURIComponent(projectId)}/timeline?limit=100`, { cache: "no-store" }),
      ]);
      if (!tasksResponse.ok || !timelineResponse.ok) {
        setTasks([]);
        setTimeline([]);
        setStatus(t("community.projects.statusLoadTasksFailed"));
        return;
      }
      const tasksPayload = (await tasksResponse.json()) as ProjectTasksResponse;
      const timelinePayload = (await timelineResponse.json()) as ProjectTimelineResponse;
      setTasks(tasksPayload.items || []);
      setTimeline(timelinePayload.items || []);
    },
    [t]
  );

  const reloadAll = useCallback(async () => {
    setStatus(t("community.projects.statusLoadingWorkspace"));
    await Promise.all([loadProjects(), loadRooms()]);
    setStatus(t("community.projects.statusOk"));
  }, [loadProjects, loadRooms, t]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    void Promise.all([loadLinks(activeProjectId), loadTasksAndTimeline(activeProjectId)]);
  }, [activeProjectId, loadLinks, loadTasksAndTimeline]);

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    const description = newProjectDescription.trim();
    if (name.length < 2) {
      setStatus(t("community.projects.statusNameTooShort"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/community/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
        }),
      });
      if (!response.ok) {
        setStatus(withHttpStatus(t("community.projects.statusCreateFailedHttp"), response.status));
        return;
      }
      const payload = (await response.json()) as { project?: ProjectRecord };
      const createdProjectId = payload.project?.id || "";
      setNewProjectName("");
      setNewProjectDescription("");
      await loadProjects();
      if (createdProjectId) setActiveProjectId(createdProjectId);
      setStatus(t("community.projects.statusCreated"));
    } finally {
      setBusy(false);
    }
  }, [loadProjects, newProjectDescription, newProjectName, t]);

  const linkRoom = useCallback(async () => {
    if (!activeProjectId || !selectedRoomId) {
      setStatus(t("community.projects.statusSelectProjectAndRoom"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/community/projects/${encodeURIComponent(activeProjectId)}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomId: selectedRoomId,
          role: selectedRole,
        }),
      });
      if (!response.ok) {
        setStatus(withHttpStatus(t("community.projects.statusLinkFailedHttp"), response.status));
        return;
      }
      await loadLinks(activeProjectId);
      setStatus(t("community.projects.statusLinked"));
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, loadLinks, selectedRole, selectedRoomId, t]);

  const createTask = useCallback(async () => {
    if (!activeProjectId) {
      setStatus(t("community.projects.statusSelectProjectBeforeTask"));
      return;
    }
    const title = newTaskTitle.trim();
    if (title.length < 2) {
      setStatus(t("community.projects.statusTaskTitleTooShort"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/community/projects/${encodeURIComponent(activeProjectId)}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          kind: newTaskKind,
          status: "todo",
        }),
      });
      if (!response.ok) {
        setStatus(withHttpStatus(t("community.projects.statusTaskCreateFailedHttp"), response.status));
        return;
      }
      setNewTaskTitle("");
      await loadTasksAndTimeline(activeProjectId);
      setStatus(t("community.projects.statusTaskCreated"));
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, loadTasksAndTimeline, newTaskKind, newTaskTitle, t]);

  const updateTaskStatus = useCallback(
    async (taskId: string, statusValue: ProjectTaskStatus) => {
      if (!activeProjectId || !taskId) return;
      setBusy(true);
      try {
        const response = await fetch(
          `/api/community/projects/${encodeURIComponent(activeProjectId)}/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              status: statusValue,
            }),
          }
        );
        if (!response.ok) {
          setStatus(withHttpStatus(t("community.projects.statusTaskUpdateFailedHttp"), response.status));
          return;
        }
        await loadTasksAndTimeline(activeProjectId);
        setStatus(t("community.projects.statusTaskUpdated"));
      } finally {
        setBusy(false);
      }
    },
    [activeProjectId, loadTasksAndTimeline, t]
  );

  const renderTimelineDetails = useCallback(
    (event: ProjectTimelineEventRecord): string => {
      const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : "";
      const roomId = typeof event.payload.roomId === "string" ? event.payload.roomId : "";
      const kind = typeof event.payload.kind === "string" ? event.payload.kind : "";
      const statusValue = typeof event.payload.status === "string" ? event.payload.status : "";
      if (kind) return withKind(t("community.projects.timelineDetailKind"), kind);
      if (statusValue) return withStatus(t("community.projects.timelineDetailStatus"), statusValue);
      if (taskId) return withTaskId(t("community.projects.timelineDetailTaskId"), taskId);
      if (roomId) return withRoomId(t("community.projects.timelineDetailRoomId"), roomId);
      return "";
    },
    [t]
  );

  return (
    <section className="space-y-4" data-testid="community-projects-workspace-root">
      <div className="rr-article-panel space-y-3 p-4">
        <h1 className="text-lg font-semibold text-[#e6e8ec]">{t("community.projects.workspaceTitle")}</h1>
        <p className="text-sm text-[#9aa3b2]">{t("community.projects.workspaceDescription")}</p>
      </div>

      <div className="rr-article-panel space-y-3 p-4">
        <div className="text-sm font-semibold text-[#e6e8ec]">{t("community.projects.newProjectTitle")}</div>
        <input
          className="w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
          placeholder={t("community.projects.inputProjectNamePlaceholder")}
          value={newProjectName}
          onChange={(event) => setNewProjectName(event.target.value)}
          data-testid="community-project-name-input"
        />
        <textarea
          className="min-h-[72px] w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#cfd6df]"
          placeholder={t("community.projects.inputProjectDescriptionPlaceholder")}
          value={newProjectDescription}
          onChange={(event) => setNewProjectDescription(event.target.value)}
          data-testid="community-project-description-input"
        />
        <button
          type="button"
          className="rounded-md border border-[#4a6fa1] px-3 py-1.5 text-sm text-[#d9ebff] disabled:opacity-60"
          onClick={createProject}
          disabled={busy}
          data-testid="community-project-create-submit"
        >
          {t("community.projects.createProject")}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rr-article-panel space-y-3 p-4">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("community.projects.myProjectsTitle")}</div>
          <select
            className="w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
            value={activeProjectId}
            onChange={(event) => setActiveProjectId(event.target.value)}
            data-testid="community-project-active-select"
          >
            <option value="">{t("community.projects.selectProjectOption")}</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="space-y-2" data-testid="community-project-list">
            {projects.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-[#2d3f56] bg-[#111826] p-2 text-sm text-[#d7dde6]"
                data-testid={`community-project-item-${item.id}`}
              >
                <div className="font-medium text-[#e6e8ec]">{item.name}</div>
                {item.description ? <div className="text-xs text-[#9aa3b2]">{item.description}</div> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rr-article-panel space-y-3 p-4">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("community.projects.linkRoomTitle")}</div>
          <select
            className="w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
            value={selectedRoomId}
            onChange={(event) => setSelectedRoomId(event.target.value)}
            data-testid="community-project-room-select"
          >
            <option value="">{t("community.projects.selectRoomOption")}</option>
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>

          <select
            className="w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value as "owner" | "editor" | "viewer")}
            data-testid="community-project-role-select"
          >
            <option value="owner">{t("community.projects.role.owner")}</option>
            <option value="editor">{t("community.projects.role.editor")}</option>
            <option value="viewer">{t("community.projects.role.viewer")}</option>
          </select>

          <button
            type="button"
            className="rounded-md border border-[#4a6fa1] px-3 py-1.5 text-sm text-[#d9ebff] disabled:opacity-60"
            onClick={linkRoom}
            disabled={busy}
            data-testid="community-project-link-submit"
          >
            {t("community.projects.linkRoomButton")}
          </button>

          <div className="space-y-2" data-testid="community-project-room-links">
            {links.length === 0 ? <div className="text-sm text-[#9aa3b2]">{t("community.projects.emptyLinks")}</div> : null}
            {links.map((link) => (
              <div
                key={link.id}
                className="rounded-md border border-[#2d3f56] bg-[#111826] p-2 text-sm text-[#d7dde6]"
                data-testid={`community-project-link-item-${link.id}`}
              >
                <div className="font-medium text-[#e6e8ec]">{roomById.get(link.roomId)?.title || link.roomId}</div>
                <div className="text-xs text-[#9aa3b2]">{withRole(t("community.projects.roleLabel"), link.role)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rr-article-panel space-y-3 p-4">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("community.projects.tasksTitle")}</div>
          <div className="grid gap-2 md:grid-cols-[1fr,180px,auto]">
            <input
              className="w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
              placeholder={t("community.projects.inputTaskTitlePlaceholder")}
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              data-testid="community-project-task-title-input"
            />
            <select
              className="w-full rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
              value={newTaskKind}
              onChange={(event) => setNewTaskKind(event.target.value as ProjectTaskKind)}
              data-testid="community-project-task-kind-select"
            >
              {TASK_KIND_ORDER.map((kind) => (
                <option key={kind} value={kind}>
                  {taskKindLabel(kind)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-[#4a6fa1] px-3 py-1.5 text-sm text-[#d9ebff] disabled:opacity-60"
              onClick={createTask}
              disabled={busy}
              data-testid="community-project-task-create-submit"
            >
              {t("community.projects.createTask")}
            </button>
          </div>

          <div className="space-y-2" data-testid="community-project-task-list">
            {tasks.length === 0 ? <div className="text-sm text-[#9aa3b2]">{t("community.projects.emptyTasks")}</div> : null}
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-md border border-[#2d3f56] bg-[#111826] p-2 text-sm text-[#d7dde6]"
                data-testid={`community-project-task-item-${task.id}`}
              >
                <div className="font-medium text-[#e6e8ec]">{task.title}</div>
                <div className="text-xs text-[#9aa3b2]">
                  {taskKindLabel(task.kind)} • {taskStatusLabel(task.status)}
                </div>
                <select
                  className="mt-2 w-full rounded-md border border-[#2d3f56] bg-[#111826] px-2 py-1 text-xs text-[#e6e8ec]"
                  value={task.status}
                  onChange={(event) => void updateTaskStatus(task.id, event.target.value as ProjectTaskStatus)}
                  disabled={busy}
                  data-testid={`community-project-task-status-select-${task.id}`}
                >
                  {TASK_STATUS_ORDER.map((statusValue) => (
                    <option key={statusValue} value={statusValue}>
                      {taskStatusLabel(statusValue)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="rr-article-panel space-y-3 p-4">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("community.projects.timelineTitle")}</div>
          <div className="space-y-2" data-testid="community-project-timeline-list">
            {timeline.length === 0 ? <div className="text-sm text-[#9aa3b2]">{t("community.projects.emptyTimeline")}</div> : null}
            {timeline.map((event) => (
              <div
                key={event.id}
                className="rounded-md border border-[#2d3f56] bg-[#111826] p-2 text-sm text-[#d7dde6]"
                data-testid={`community-project-timeline-item-${event.id}`}
              >
                <div className="font-medium text-[#e6e8ec]">{timelineTypeLabel(event.type)}</div>
                <div className="text-xs text-[#9aa3b2]">{withActor(t("community.projects.timelineActor"), event.actorUserId)}</div>
                {renderTimelineDetails(event) ? (
                  <div className="text-xs text-[#9aa3b2]">{renderTimelineDetails(event)}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-xs text-[#9cc4ff]" data-testid="community-projects-status">
        {status}
      </div>
    </section>
  );
}
