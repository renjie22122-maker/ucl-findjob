import { isJobDue, listCrawlJobs, runCrawlJob } from './services/crawlJobs.service.js';
import {
  isProfileDue,
  listSearchProfiles,
  runProfile,
  type RecommendationRun,
} from './services/recommendations.service.js';

/**
 * 定时抓取调度器（应用运行期间生效）：
 * 每分钟检查一次到期任务，串行执行（爬虫本身有限速，避免并发风控）。
 * 说明：本地应用，仅在服务运行期间执行；重启后首次检查会补跑到期任务。
 */
let queue: Promise<void> = Promise.resolve();
let started = false;

async function processDueJobs(): Promise<void> {
  try {
    const jobs = listCrawlJobs();
    for (const job of jobs) {
      if (isJobDue(job)) {
        console.log(`[scheduler] 任务「${job.keyword}」到期，开始抓取…`);
        await runCrawlJob(job.id);
      }
    }

    const profiles = listSearchProfiles();
    for (const profile of profiles) {
      if (isProfileDue(profile)) {
        console.log(`[scheduler] 搜索画像「${profile.name}」到期，开始生成岗位推荐…`);
        await runProfile(profile.id);
      }
    }
  } catch (err) {
    console.error('[scheduler]', err);
  }
}

/** 手动触发一次任务执行（run-now 端点用），并入串行队列避免并发 */
export function enqueueJobRun(jobId: number): void {
  const task = queue.then(async () => {
    await runCrawlJob(jobId);
  });
  queue = task.catch((err: unknown) => {
    console.error('[scheduler] 手动抓取任务失败：', err);
  });
}

/** 手动触发画像执行，并与抓取任务共用串行队列，避免多路爬虫同时访问上游。 */
export function enqueueRecommendationRun(profileId: number): Promise<RecommendationRun> {
  const task = queue.then(() => runProfile(profileId));
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function startScheduler(intervalMs = 60_000): void {
  if (started) return;
  started = true;
  const tick = () => {
    const task = queue.then(processDueJobs);
    queue = task.catch((err: unknown) => {
      console.error('[scheduler] 定时任务失败：', err);
    });
  };
  tick(); // 启动时先检查一轮（重启补跑）
  setInterval(tick, intervalMs);
}
