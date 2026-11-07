"""Evaluate the current reminder window without claiming an exact GitHub queue delay."""
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


def values(field, low, high):
    result = set()
    for part in field.split(','):
        base, _, step = part.partition('/')
        step = int(step or '1')
        if step < 1:
            raise ValueError('无效 cron 步长')
        if base == '*':
            start, end = low, high
        elif '-' in base:
            start, end = map(int, base.split('-'))
        else:
            start = end = int(base)
        if start < low or end > high or start > end:
            raise ValueError('无效 cron 范围')
        result.update(range(start, end + 1, step))
    return result


def latest_slot(schedules, now):
    found = []
    for expression in schedules:
        minute, hour, day, month, weekday = expression.split()
        minutes, hours = values(minute, 0, 59), values(hour, 0, 23)
        days, months, weekdays = values(day, 1, 31), values(month, 1, 12), values(weekday, 0, 7)
        weekdays = {value % 7 for value in weekdays}
        for offset in range(367):
            date = now.date() - timedelta(days=offset)
            dom, dow = date.day in days, (date.weekday() + 1) % 7 in weekdays
            matches = (dom and dow) if day == '*' or weekday == '*' else (dom or dow)
            if date.month not in months or not matches:
                continue
            slots = [datetime(date.year, date.month, date.day, h, m, tzinfo=timezone.utc)
                     for h in hours for m in minutes]
            slots = [slot for slot in slots if slot <= now]
            if slots:
                found.append(max(slots))
                break
    if not found:
        raise ValueError('无法确定当前计划时段')
    return max(found)


def assess(task, event, now):
    result = {'observed_at': now.isoformat(), 'event': event, 'expired': False,
              'slot_basis': 'most_recent_current_schedule', 'slot': None, 'expires_at': None}
    if event != 'schedule':
        return result
    slot = latest_slot(task['schedule'], now)
    result.update(slot=slot.isoformat(), elapsed_minutes=round((now - slot).total_seconds() / 60, 1))
    if task['id'] == 'hk-ipo-alerts':
        expiry = slot + timedelta(minutes=45)
        result.update(expires_at=expiry.isoformat(), expired=now > expiry)
    return result


def main():
    from automation_tasks import ROOT, tasks
    task = next(task for task in tasks() if task['id'] == os.environ['TASK_ID'])
    result = assess(task, os.environ['GITHUB_EVENT_NAME'], datetime.now(timezone.utc))
    result['trigger_commit'] = os.environ['GITHUB_SHA']
    result['execution_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    result['trigger_schedule'] = os.environ.get('TRIGGER_SCHEDULE') or None
    out = ROOT / 'output'
    out.mkdir(exist_ok=True)
    (out / 'schedule-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
        handle.write('expired=' + str(result['expired']).lower() + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as handle:
        handle.write('### 调度时效\n\n')
        handle.write(f"触发版本：`{result['trigger_commit'][:8]}`；实际执行版本：`{result['execution_commit'][:8]}`。\n\n")
        if result['slot']:
            handle.write(f"按当前配置推算最近时段：{result['slot']}；当前距该时段 {result['elapsed_minutes']} 分钟。此值不是 GitHub 原始排队时长。\n\n")
        handle.write('本轮已超出45分钟提醒窗口，跳过研究与发信，等待下一有效时段。\n' if result['expired'] else '通过时效检查。\n')
    if result['expired']:
        print('::notice::当前提醒窗口已过期，未调用模型或发送提醒；详见调度检查附件。')


if __name__ == '__main__':
    main()
