import React from "react";
import { cancelSourceTask, dismissSourceTask, hydrateSourceTasks, useSourceBackgroundTasks } from "./sourceBackgroundTasks";
import "./sourceBackgroundTasks.css";

const SourceBackgroundTaskIndicator = () => {
  const tasks = useSourceBackgroundTasks();
  React.useEffect(() => {
    void hydrateSourceTasks();
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void hydrateSourceTasks();
    };
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, []);
  if (!tasks.length) return null;

  return (
    <aside id="source_background_tasks" aria-label="Background source tasks">
      {tasks.slice(0, 3).map((task) => (
        <div key={task.id} className={`source_background_task source_background_task--${task.status}`}>
          <div className="source_background_task__copy">
            <strong>{task.kind === "split" ? "Splitting" : "Uploading"}: {task.name}</strong>
            <span>{task.message}</span>
          </div>
          {task.status === "running" && (
            <div className="source_background_task__track" aria-label={`${task.progress}%`}>
              <span style={{ width: `${task.progress}%` }} />
            </div>
          )}
          <button
            type="button"
            className={task.status === "running" ? "source_background_task__cancel" : "source_background_task__dismiss"}
            onClick={() => task.status === "running" ? cancelSourceTask(task.id) : dismissSourceTask(task.id)}
            aria-label={`${task.status === "running" ? "Cancel" : "Dismiss"} ${task.name}`}
          >
            {task.status === "running" ? "Cancel" : "x"}
          </button>
        </div>
      ))}
    </aside>
  );
};

export default SourceBackgroundTaskIndicator;
