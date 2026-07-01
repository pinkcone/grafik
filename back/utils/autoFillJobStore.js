const { randomUUID } = require('crypto');

const jobsByUser = new Map();
const MAX_JOBS_PER_USER = 40;

function getUserJobs(userId) {
  if (!jobsByUser.has(userId)) {
    jobsByUser.set(userId, []);
  }
  return jobsByUser.get(userId);
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
        ? 'Trwa uzupełnianie tras…'
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
  return job;
};

exports.completeJob = (userId, jobId, { message, result }) => {
  const job = findJob(userId, jobId);
  if (!job) return null;
  job.status = 'completed';
  job.finishedAt = new Date().toISOString();
  job.message = message;
  job.result = result;
  return job;
};

exports.failJob = (userId, jobId, error) => {
  const job = findJob(userId, jobId);
  if (!job) return null;
  job.status = 'failed';
  job.finishedAt = new Date().toISOString();
  job.error = error;
  job.message = error;
  return job;
};

exports.getJobsForUser = (userId) => getUserJobs(userId).map(toNotification);

exports.getJob = (userId, jobId) => {
  const job = findJob(userId, jobId);
  return job ? toNotification(job, { includeDebug: true }) : null;
};

exports.markJobRead = (userId, jobId) => {
  const job = findJob(userId, jobId);
  if (job) job.read = true;
};

exports.markAllRead = (userId) => {
  getUserJobs(userId).forEach((j) => {
    j.read = true;
  });
};
