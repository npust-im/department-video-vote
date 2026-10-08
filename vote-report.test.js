import test from 'node:test';
import assert from 'node:assert/strict';
import readXlsxFile from 'read-excel-file/node';
import writeExcelFile from 'write-excel-file/node';
import { buildExportTables, buildVoteReport } from './src/vote-report.js';

test('票數、得票率、投票率與排序一致', () => {
  const options = [
    { id: 1, title: 'A', video_url: 'https://example.com/a' },
    { id: 2, title: 'B', video_url: 'https://example.com/b' },
    { id: 3, title: 'C', video_url: 'https://example.com/c' },
  ];
  const users = Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, name: `使用者${i}` }));
  const votes = users.slice(0, 80).map((user, i) => ({
    user_id: user.id,
    option_id: i < 25 ? 1 : i < 43 ? 2 : 3,
    created_at: new Date(Date.UTC(2026, 9, 8, 12, 0, i)).toISOString(),
  }));
  const report = buildVoteReport(options, votes, users);
  assert.deepEqual(report.results.map((item) => [item.code, item.votes, item.percent.toFixed(2)]), [
    ['作品03', 37, '46.25'], ['作品01', 25, '31.25'], ['作品02', 18, '22.50'],
  ]);
  assert.equal(report.totalVoters, 100);
  assert.equal(report.votedAccounts, 80);
  assert.equal(report.remaining, 20);
  assert.equal(report.turnout, 80);
  assert.equal(report.records[0].account, '使用者79');
  assert.equal(report.records[0].code, '作品03');
});

test('零票時保留作品且百分比為零', () => {
  const report = buildVoteReport([{ id: 9, title: '未得票', video_url: '' }], [], []);
  assert.equal(report.results[0].votes, 0);
  assert.equal(report.results[0].percent, 0);
  assert.equal(report.turnout, 0);
  assert.deepEqual(report.records, []);
});

test('Excel 匯出同時包含紀錄與統計兩個工作表', async () => {
  const report = buildVoteReport(
    [{ id: 1, title: '作品甲', video_url: 'https://example.com' }],
    [{ user_id: 'u1', option_id: 1, created_at: '2026-10-08T04:00:00Z' }],
    [{ id: 'u1', name: '王小明' }],
  );
  const tables = buildExportTables(report, () => '2026/10/08 12:00:00');
  const buffer = await writeExcelFile([
    { sheet: '投票紀錄', data: tables.records },
    { sheet: '作品統計', data: tables.results },
  ]).toBuffer();
  assert.deepEqual(await readXlsxFile(buffer, { sheet: '投票紀錄' }), tables.records);
  assert.deepEqual(await readXlsxFile(buffer, { sheet: '作品統計' }), tables.results);
});
