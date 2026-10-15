import { useState } from "react";
import type { ResolvedConfig } from "../core/config";
import { Icon } from "./Icons";

export function ProjectSwitch({
  config,
  from,
  busy,
  disabled,
  onClose,
  onConfirm,
}: {
  config: ResolvedConfig;
  from?: string;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const zh = config.locale === "zh";
  return (
    <>
      <div className="project-switch-body">
        <p>
          {zh
            ? "此操作需要将你的交易账户绑定到当前项目方。请核对变更后确认。"
            : "This action requires your Trading Account to be bound to this project. Review the change before confirming."}
        </p>
        <dl>
          <Identity key={from} config={config} id={from} />
          <div className="project-arrow" aria-hidden="true">
            <Icon name="down" size={16} />
          </div>
          <Identity
            key={config.projectId}
            config={config}
            id={config.projectId}
            target
          />
        </dl>
        <p className="project-impact">
          {zh
            ? "切换项目方前，请确保你在其他项目方下没有未偿还借款，并妥善处理相关仓位。切换成功后，原项目方的部分功能可能无法使用。"
            : "Before switching projects, make sure you have no outstanding loans with other projects and have taken care of the related positions. After switching, some features of your previous project may no longer be available."}
        </p>
      </div>
      <div className="project-switch-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>
          {zh ? "取消" : "Cancel"}
        </button>
        <button className="primary" disabled={disabled} onClick={onConfirm}>
          {busy
            ? zh
              ? "处理中…"
              : "Processing…"
            : zh
              ? "确认切换"
              : "Confirm switch"}
        </button>
      </div>
    </>
  );
}
function Identity({
  config,
  id,
  target = false,
}: {
  config: ResolvedConfig;
  id?: string;
  target?: boolean;
}) {
  const zh = config.locale === "zh";
  const project = config.projects.find(
    (p) => p.projectId.toLowerCase() === id?.toLowerCase(),
  );
  const [copy, setCopy] = useState("");
  return (
    <div className={`project-identity ${target ? "target" : ""}`}>
      <dt>
        {target
          ? zh
            ? "目标项目方"
            : "Target project"
          : zh
            ? "原项目方"
            : "Original project"}
      </dt>
      <dd>
        <div className="project-identity-heading">
          {project?.logo && (
            <img src={project.logo} alt="" width={24} height={24} />
          )}
          <strong>
            {project?.name || (zh ? "未知项目方" : "Unknown project")}
          </strong>
          {id && (
            <button
              className="project-id"
              title={id}
              aria-label={`${zh ? "复制项目 ID" : "Copy project ID"}: ${id}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(id);
                  setCopy(zh ? "已复制" : "Copied");
                } catch {
                  setCopy(
                    zh
                      ? "复制失败，请手动复制项目 ID"
                      : "Copy failed. Copy the project ID manually.",
                  );
                }
              }}
            >
              {id.slice(0, 6)}…{id.slice(-4)} <Icon name="copy" size={12} />
            </button>
          )}
        </div>
        <span role="status">{copy}</span>
        {project?.description && (
          <p>{project.description[config.locale] ?? project.description.en}</p>
        )}
        {!target && (
          <div className="project-manage">
            {project?.repayUrl ? (
              <a
                href={project.repayUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {zh ? "管理借款与仓位 ↗" : "Manage loans and positions ↗"}
              </a>
            ) : (
              <p>{zh ? "未配置还款链接" : "Repayment link not configured"}</p>
            )}
          </div>
        )}
      </dd>
    </div>
  );
}
