import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { clearAllData, getSettings, updateSettings } from "../shared/api";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { applyTheme } from "../shared/theme";
import type { Settings } from "../shared/types";
import "./options.css";

function OptionsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("数据只保存在当前浏览器本地，默认永久保留。");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const config = await getSettings();
      setSettings(config.settings);
      applyTheme("dark");
    })();
  }, []);

  async function saveAll() {
    await updateSettings(settings);
    applyTheme(settings.theme === "light" ? "light" : "dark");
    setStatus("设置已保存到本地浏览器。");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="opt-app">
      <header className="opt-top">
        <div className="opt-brand">
          <div className="opt-logo" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>NightWatch · 设置</h1>
            <p>本地工作节律观察站</p>
          </div>
        </div>
        <div className="opt-top-actions">
          <button
            type="button"
            className="opt-btn"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") })}
          >
            历史仪表盘
          </button>
          <button type="button" className="opt-btn primary" onClick={() => void saveAll()}>
            {saved ? "已保存" : "保存设置"}
          </button>
        </div>
      </header>

      <section className={`opt-status ${saved ? "ok" : ""}`}>
        <strong>本地永久历史</strong>
        <small>{status}</small>
      </section>

      <section className="opt-card">
        <div className="opt-card-head">
          <div>
            <h2>显示与默认视图</h2>
            <p>控制界面主题和仪表盘打开后的默认历史范围</p>
          </div>
        </div>
        <div className="opt-card-body">
          <div className="opt-grid">
            <div className="opt-field">
              <label htmlFor="theme">主题</label>
              <select
                id="theme"
                value={settings.theme}
                onChange={(event) => {
                  const next = event.target.value as Settings["theme"];
                  setSettings((current) => ({ ...current, theme: next }));
                  applyTheme(next === "light" ? "light" : "dark");
                }}
              >
                <option value="system">跟随系统</option>
                <option value="dark">深色</option>
                <option value="light">浅色</option>
              </select>
            </div>
            <div className="opt-field">
              <label htmlFor="range">默认仪表盘范围</label>
              <select
                id="range"
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
            </div>
          </div>
          <p className="opt-hint">深色主题与 NightWatch / 仪表盘保持同一套视觉语言；浅色仅影响全局主题变量。</p>
        </div>
      </section>

      <section className="opt-card">
        <div className="opt-card-head">
          <div>
            <h2>数据操作</h2>
            <p>以下操作只影响当前浏览器本地数据</p>
          </div>
        </div>
        <div className="opt-card-body">
          <div className="opt-danger-box">
            <div>
              <strong>清空统计数据</strong>
              <small>会删除全部本地活跃记录、成就进度与备注，且无法撤销。</small>
            </div>
            <button
              type="button"
              className="opt-btn danger"
              onClick={async () => {
                if (!window.confirm("确认清空全部本地统计数据？此操作无法撤销。")) return;
                await clearAllData();
                setStatus("已清空全部本地统计数据。");
              }}
            >
              清空统计数据
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<OptionsApp />);
