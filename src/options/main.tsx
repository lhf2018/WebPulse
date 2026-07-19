import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { clearAllData, getSettings, updateSettings } from "../shared/api";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { applyTheme } from "../shared/theme";
import type { Settings } from "../shared/types";
import { ActionButton, Field, PageShell, SectionCard } from "../ui/components";
import "../ui/styles.css";

function OptionsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("数据只保存在当前浏览器本地，默认永久保留。");

  useEffect(() => {
    void (async () => {
      const config = await getSettings();
      setSettings(config.settings);
      applyTheme(config.settings.theme);
    })();
  }, []);

  async function saveAll() {
    await updateSettings(settings);
    applyTheme(settings.theme);
    setStatus("设置已保存到本地浏览器。");
  }

  return (
    <PageShell
      title="插件设置"
      subtitle="历史数据只存储在本地 IndexedDB，不设置自动过期时间。"
      action={
        <>
          <div className="top-nav-actions">
            <button
              type="button"
              className="nav-pill"
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") })}
            >
              历史仪表盘
            </button>
            <button
              type="button"
              className="nav-pill"
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("achievements.html") })}
            >
              成就系统
            </button>
          </div>
          <ActionButton onClick={() => void saveAll()}>保存设置</ActionButton>
        </>
      }
    >
      <SectionCard>
        <div className="status-banner refined">
          <div>
            <strong>本地永久历史</strong>
            <small>{status}</small>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="显示与默认视图" subtitle="控制界面主题和仪表盘打开后的默认历史范围">
          <div className="details-grid">
            <Field label="主题">
              <select
                value={settings.theme}
                onChange={(event) => {
                  const next = event.target.value as Settings["theme"];
                  setSettings((current) => ({ ...current, theme: next }));
                  applyTheme(next);
                }}
              >
                <option value="system">跟随系统</option>
                <option value="dark">深色</option>
                <option value="light">浅色</option>
              </select>
            </Field>

            <Field label="默认仪表盘范围">
              <select
                value={settings.dashboardDefaultRange}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    dashboardDefaultRange: event.target.value as Settings["dashboardDefaultRange"]
                  }))
                }
              >
                <option value="all">全部历史</option>
                <option value="month">本月</option>
                <option value="week">近 7 天</option>
              </select>
            </Field>
          </div>
      </SectionCard>

      <SectionCard title="数据操作" subtitle="以下操作只影响当前浏览器本地数据">
        <div className="hero-action">
          <ActionButton
            variant="ghost"
            onClick={async () => {
              if (!window.confirm("确认清空全部本地统计数据？此操作无法撤销。")) return;
              await clearAllData();
              setStatus("已清空全部本地统计数据。");
            }}
          >
            清空统计数据
          </ActionButton>
        </div>
      </SectionCard>
    </PageShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<OptionsApp />);
