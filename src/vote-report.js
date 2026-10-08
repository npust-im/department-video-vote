export const optionCode = (id) => `作品${String(id).padStart(2, '0')}`;

export function buildVoteReport(options, votes, users) {
  const counts = new Map();
  for (const vote of votes) counts.set(vote.option_id, (counts.get(vote.option_id) || 0) + 1);
  const results = options.map((option) => {
    const count = counts.get(option.id) || 0;
    return {
      id: option.id,
      code: optionCode(option.id),
      title: option.title,
      videoUrl: option.video_url,
      votes: count,
      percent: votes.length ? count / votes.length * 100 : 0,
    };
  }).sort((a, b) => b.votes - a.votes || a.id - b.id);
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const titles = new Map(options.map((option) => [option.id, option.title]));
  const records = [...votes].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((vote) => ({
    account: userNames.get(vote.user_id) || '已刪除帳號',
    code: optionCode(vote.option_id),
    title: titles.get(vote.option_id) || '已刪除作品',
    createdAt: vote.created_at,
  }));
  const votedAccounts = new Set(votes.map((vote) => vote.user_id)).size;
  return {
    results,
    records,
    totalVoters: users.length,
    votedAccounts,
    remaining: Math.max(0, users.length - votedAccounts),
    turnout: users.length ? votedAccounts / users.length * 100 : 0,
  };
}

export function buildExportTables(report, formatTime) {
  return {
    records: [
      ['帳號名稱', '投票作品編號', '作品名稱', '投票時間（台灣）'],
      ...report.records.map((record) => [record.account, record.code, record.title, formatTime(record.createdAt)]),
    ],
    results: [
      ['作品編號', '作品名稱', '各作品總票數', '各作品得票率'],
      ...report.results.map((option) => [option.code, option.title, option.votes, `${option.percent.toFixed(2)}%`]),
    ],
  };
}
