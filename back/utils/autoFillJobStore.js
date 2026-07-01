const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const JOBS_FILE = path.join(DATA_DIR, 'autofill-jobs.json');
const MAX_JOBS_PER_USER = 40;

/** @type {Map<string, object[]>} */
const jobsByUser = new Map();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const raw = fs.readFileSync(JOBS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    for (const [userId, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) {
        jobsByUser.set(userId, list);
      }
    }
  } catch (err) {
    console.error('Nie udało się wczytać autofill-jobs.json:', err.message);
  }
}

function saveToDisk() {
  try {
    ensureDataDir();
    const obj = Object.fromEntries(jobsByUser.entries());
    fs.writeFileSync(JOBS_FILE, JSON.stringify(obj), 'utf8');
  } catch (err) {
    console.error('Nie udało się zapisać autofill-jobs.json:', err.message);
  }
}

loadFromDisk();

function getUserJobs(userId) {
  const key = String(userId);
  if (!jobsByUser.has(key)) {
    jobsByUser.set(key, []);
  }
  return jobsByUser.get(key);
}

function formatTitle(job) {
  const name = job.cityName || `Miasto #${job.cityId}`;
  return `Auto-uzupełnianie: ${name} (${job.month}/${job.year})`;
}

function toNotification(job, { includeDebug = false } = {}) {
  let result;
  if (job.status === 'completed' && job.result) {
    if (includeDebug) {
      result = job.result;
    } else {
      const { debug, assignments, labels, ...summary } = job.result;
      result = summary;
    }
  }

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    read: job.read,
    title: job.title || formatTitle(job),
    message:
      job.message ||
      (job.status === 'running'
        ? 'Trwa uzupełnianie tras na serwerze…'
        : job.status === 'failed'
          ? job.error || 'Błąd auto-uzupełniania'
          : ''),
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    cityId: job.cityId,
    month: job.month,
    year: job.year,
    result,
    error: job.status === 'failed' ? job.error : undefined,
  };
}

function findJob(userId, jobId) {
  return getUserJobs(userId).find((j) => j.id === jobId) || null;
}

exports.createJob = (userId, meta) => {
  const job = {
    id: randomUUID(),
    userId,
    type: 'auto_fill',
    status: 'running',
    read: false,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    message: null,
    result: null,
    error: null,
    ...meta,
  };
  const list = getUserJobs(userId);
  list.unshift(job);
  if (list.length > MAX_JOBS_PER_USER) {
    list.splice(MAX_JOBS_PER_USER);
  }
  saveToDisk();
  return job;
};

exports.completeJob = (userId, jobId, { message, result }) => {
  const job = findJob(userId, jobId);
  if (!job) return null;
  job.status = 'completed';
  job.finishedAt = new Date().toISOString();
  job.message = message;
  job.result = result;
  saveToDisk();
  return job;
};

exports.failJob = (userId, jobId, error) => {
  const job = findJob(userId, jobId);
  if (!job) return null;
  job.status = 'failed';
  job.finishedAt = new Date().toISOString();
  job.error = error;
  job.message = error;
  saveToDisk();
  return job;
};

exports.getJobsForUser = (userId) => getUserJobs(userId).map(toNotification);

exports.getJob = (userId, jobId) => {
  const job = findJob(userId, jobId);
  return job ? toNotification(job, { includeDebug: true }) : null;
};

exports.markJobRead = (userId, jobId) => {
  const job = findJob(userId, jobId);
  if (job) {
    job.read = true;
    saveToDisk();
  }
};

exports.markAllRead = (userId) => {
  getUserJobs(userId).forEach((j) => {
    j.read = true;
  });
  saveToDisk();
};

exports.hasRunningJobs = (userId) =>
  getUserJobs(userId).some((j) => j.status === 'running');
