import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getPopupSnapshot, getSettings, openDashboard } from "../shared/api";
import { applyTheme } from "../shared/theme";
import type { PopupSnapshot } from "../shared/types";
import { formatClockDuration, formatDuration } from "../shared/time";
import { STORAGE_KEYS } from "../shared/storage/local";
import { ActionButton, MetricCard } from "../ui/components";
import { RankBars, RhythmBars } from "../ui/charts";
import "../ui/styles.css";

function shortDay(dateKey: string) {
  return dateKey.slice(5).replace("-", ".");
}

function formatTime(value?: number) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function openLocalPage(path: string) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

function PopupApp() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  async function refresh() {
    const [nextSnapshot, config] = await Promise.all([getPopupSnapshot(), getSettings()]);
    setSnapshot(nextSnapshot);
    setNowMs(Date.now());
    applyTheme(config.settings.theme);
  }

  useEffect(() => {
    void refresh();
    const refresher = window.setInterval(() => void refresh(), 9000);
    const ticker = window.setInterval(() => setNowMs(Date.now()), 1000);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.popup]) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      window.clearInterval(refresher);
      window.clearInterval(ticker);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  if (!snapshot) {
    return <div className="loading-state">正在读取本地历史数据...</div>;
  }

  const liveTodayMs =
    snapshot.totalActiveMs + (snapshot.trackingActive ? Math.max(0, nowMs - snapshot.updatedAt) : 0);
  const liveRecentDays = snapshot.recentDays.map((day) =>
    day.dateKey === snapshot.dateKey ? { ...day, totalActiveMs: liveTodayMs } : day
  );
  const liveMaxRecent = Math.max(1, ...liveRecentDays.map((day) => day.totalActiveMs));
  const unlockedCount = snapshot.profile.achievements.filter((item) => item.unlocked).length;

  return (
    <div className="popup-frame">
      <div className="popup-compact popup-history">
        <div className="popup-top-actions">
          <ActionButton
            onClick={async () => {
              await openDashboard();
              window.close();
            }}
          >
            历史仪表盘
          </ActionButton>
          <ActionButton variant="secondary" onClick={() => void openLocalPage("achievements.html")}>
            成就系统
          </ActionButton>
        </div>

        <div className="popup-kpi-row">
          <MetricCard label="今日时长" value={formatClockDuration(liveTodayMs)} tone="blue" />
          <MetricCard label="今日站点" value={`${snapshot.uniqueDomainCount}`} tone="mint" />
          <MetricCard label="成就" value={`${unlockedCount}/${snapshot.profile.achievements.length}`} tone="rose" />
        </div>

        <section className="compact-panel wide">
          <div className="compact-title">
            <strong>成长等级</strong>
            <span>{snapshot.profile.xp} XP</span>
          </div>
          <div className="level-compact">
            <div className="level-orb">
              <span>Lv</span>
              <strong>{snapshot.profile.level}</strong>
            </div>
            <div className="level-info">
              <strong>{snapshot.profile.levelTitle}</strong>
              <small>距离下一级 {Math.max(0, snapshot.profile.nextLevelXp - snapshot.profile.xp)} XP</small>
              <div className="xp-bar">
                <span style={{ width: `${snapshot.profile.progress * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="time-pair compact">
            <div>
              <span>今日最早</span>
              <strong>{formatTime(snapshot.todayWindow.firstUsedAt)}</strong>
              <small>{snapshot.todayWindow.firstDomain ?? "暂无"}</small>
            </div>
            <div>
              <span>今日最晚</span>
              <strong>{formatTime(snapshot.todayWindow.lastUsedAt)}</strong>
              <small>{snapshot.todayWindow.lastDomain ?? "暂无"}</small>
            </div>
          </div>
        </section>

        <section className="compact-panel rhythm-panel wide">
          <div className="compact-title">
            <strong>今日活跃节奏</strong>
            <span>24 小时</span>
          </div>
          <RhythmBars values={snapshot.hourlyActivity} compact />
        </section>

        <section className="compact-panel wide">
          <div className="compact-title">
            <strong>最近 7 天</strong>
            <span>历史</span>
          </div>
          <div className="recent-day-list compact">
            {liveRecentDays.map((day) => (
              <div className="recent-day-row" key={day.dateKey}>
                <div>
                  <strong>{shortDay(day.dateKey)}</strong>
                  <small>{day.uniqueDomainCount} 个站点 / {day.openedTabCount} 个标签页</small>
                </div>
                <div className="recent-day-meter">
                  <span style={{ width: `${(day.totalActiveMs / liveMaxRecent) * 100}%` }} />
                </div>
                <b>{formatDuration(day.totalActiveMs)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="compact-panel wide">
          <div className="compact-title">
            <strong>今日站点排行</strong>
            <span>Top 5</span>
          </div>
          {snapshot.topDomains.length ? (
            <RankBars data={snapshot.topDomains} limit={5} />
          ) : (
            <div className="empty-state">今天还没有可展示的数据</div>
          )}
        </section>

        <footer className="popup-footer">
          <span>更新 {new Date(snapshot.updatedAt).toLocaleTimeString()}</span>
          <div className="popup-actions">
            <ActionButton variant="ghost" onClick={() => void chrome.runtime.openOptionsPage()}>
              设置
            </ActionButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<PopupApp />);
