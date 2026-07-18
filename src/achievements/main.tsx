import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getDashboardPayload, getSettings } from "../shared/api";
import { applyTheme } from "../shared/theme";
import type { Achievement, AchievementRarity, DashboardPayload } from "../shared/types";
import { formatDuration } from "../shared/time";
import { ActionButton, MetricCard, PageShell, SectionCard } from "../ui/components";
import "../ui/styles.css";

type AchievementFilter = "all" | "unlocked" | "progress" | "locked";

const RARITY_LABELS: Record<AchievementRarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说"
};

function formatDateTime(value?: number) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function matchFilter(item: Achievement, filter: AchievementFilter) {
  if (filter === "unlocked") return item.unlocked;
  if (filter === "progress") return !item.unlocked && item.progress > 0;
  if (filter === "locked") return !item.unlocked && item.progress === 0;
  return true;
}

function AchievementApp() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AchievementFilter>("all");

  useEffect(() => {
    void (async () => {
      const config = await getSettings();
      applyTheme(config.settings.theme);
      const result = await getDashboardPayload("all");
      setPayload(result);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    document.body.classList.add("achievement-body");
    return () => {
      document.body.classList.remove("achievement-body");
    };
  }, []);

  if (loading && !payload) {
    return <div className="loading-state">正在读取本地成就...</div>;
  }

  if (!payload) {
    return <div className="loading-state">暂无成就数据。</div>;
  }

  const achievements = payload.profile.achievements;
  const unlocked = achievements.filter((item) => item.unlocked);
  const locked = achievements.length - unlocked.length;
  const inProgress = achievements.filter((item) => !item.unlocked && item.progress > 0);
  const notStarted = achievements.filter((item) => !item.unlocked && item.progress === 0);
  const filteredAchievements = achievements.filter((item) => matchFilter(item, filter));
  const nextAchievement = inProgress.slice().sort((left, right) => right.progress - left.progress)[0];

  const filters: Array<{ id: AchievementFilter; label: string; count: number }> = [
    { id: "all", label: "全部", count: achievements.length },
    { id: "unlocked", label: "已解锁", count: unlocked.length },
    { id: "progress", label: "进行中", count: inProgress.length },
    { id: "locked", label: "未解锁", count: notStarted.length }
  ];

  return (
    <PageShell
      title="成就系统"
      subtitle="类似 Steam 的本地成就墙。所有成就都由当前浏览器的本地历史数据自动计算。"
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
            <button type="button" className="nav-pill active">
              成就系统
            </button>
          </div>
          <ActionButton variant="ghost" onClick={() => void chrome.runtime.openOptionsPage()}>
            设置
          </ActionButton>
        </>
      }
    >
      <div className="steam-summary-grid">
        <SectionCard title="玩家等级" subtitle="经验来自浏览时长、站点、标签页和连续记录">
          <div className="steam-level-card">
            <div className="level-orb large">
              <span>Lv</span>
              <strong>{payload.profile.level}</strong>
            </div>
            <div className="level-info">
              <strong>{payload.profile.levelTitle}</strong>
              <small>
                {payload.profile.xp} XP / 下一级 {payload.profile.nextLevelXp} XP
              </small>
              <div className="xp-bar">
                <span style={{ width: `${payload.profile.progress * 100}%` }} />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="解锁进度" subtitle={nextAchievement ? `下一个接近：${nextAchievement.title}` : "暂无进行中的成就"}>
          <div className="metric-grid">
            <MetricCard label="已解锁" value={`${unlocked.length}`} tone="mint" />
            <MetricCard label="进行中" value={`${inProgress.length}`} tone="amber" />
            <MetricCard label="未解锁" value={`${locked}`} tone="rose" />
            <MetricCard label="累计时长" value={formatDuration(payload.totals.totalActiveMs)} tone="blue" />
          </div>
        </SectionCard>

        <SectionCard title="历史时间窗" subtitle="全历史最早与最晚使用时间">
          <div className="time-pair compact">
            <div>
              <span>最早使用</span>
              <strong>{formatDateTime(payload.profile.usageWindow.firstUsedAt)}</strong>
              <small>{payload.profile.usageWindow.firstDomain ?? "暂无"}</small>
            </div>
            <div>
              <span>最晚使用</span>
              <strong>{formatDateTime(payload.profile.usageWindow.lastUsedAt)}</strong>
              <small>{payload.profile.usageWindow.lastDomain ?? "暂无"}</small>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="成就墙"
        subtitle={`当前显示 ${filteredAchievements.length} 个成就；普通 / 稀有 / 史诗 / 传说使用不同边框和光效`}
        action={
          <div className="achievement-filter-bar" role="tablist" aria-label="成就筛选">
            {filters.map((item) => (
              <button
                type="button"
                className={`filter-tab ${filter === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => setFilter(item.id)}
              >
                <span>{item.label}</span>
                <b>{item.count}</b>
              </button>
            ))}
          </div>
        }
      >
        <div className="steam-achievement-grid">
          {filteredAchievements.map((item, index) => (
            <article
              className={`steam-achievement ${item.unlocked ? "unlocked" : "locked"} rarity-${item.rarity}`}
              key={item.id}
            >
              <div className="steam-achievement-icon">
                <span>{item.unlocked ? "◆" : "◇"}</span>
                <b>{String(index + 1).padStart(2, "0")}</b>
              </div>
              <div className="steam-achievement-body">
                <div className="steam-achievement-title">
                  <strong title={item.title}>{item.title}</strong>
                  <span className={`rarity-badge rarity-${item.rarity}`}>{RARITY_LABELS[item.rarity]}</span>
                </div>
                <p>{item.description}</p>
                <div className="steam-achievement-meta">
                  <small>
                    {Math.min(item.current, item.target)} / {item.target}
                  </small>
                  <em>{item.unlocked ? "已解锁" : `${Math.floor(item.progress * 100)}%`}</em>
                </div>
                <div className="achievement-bar">
                  <span style={{ width: `${item.progress * 100}%` }} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </PageShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<AchievementApp />);
