#!/usr/bin/env python3
"""Execute documented tasks and bound research writing by explicit review results."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from codex_runner import run_codex
from automation_tasks import COMMON, ROOT, SCHEMA, reading_review_preflight, validate_result


WRITING_TASKS = {
    'security-event-research', 'ai-security-frontier-research',
    'ai-coding-rd-efficiency', 'security-architecture-defense',
}
MAX_REVISIONS = 2
TIME_BUDGET = 1800
WRITING_TIME_BUDGET = 5400
PHASE_TIMEOUTS = {'draft': 1200, 'review': 720, 'revise': 900}
CHECKS = ('facts', 'logic', 'readability', 'preservation')


class WritingBudgetError(TimeoutError):
    def __init__(self, phase, remaining, reserved):
        super().__init__('剩余时间不足以完成当前阶段并保留必要复核预算')
        self.phase, self.remaining, self.reserved = phase, remaining, reserved


def object_schema(properties):
    return {'type': 'object', 'additionalProperties': False,
            'properties': properties, 'required': list(properties)}


TEXT = {'type': 'string'}
BRIEF_SCHEMA = object_schema({key: TEXT for key in ('reader', 'question', 'takeaway', 'scope')})
DRAFT_SCHEMA = object_schema({'brief': BRIEF_SCHEMA, 'result': SCHEMA})
FINDING_SCHEMA = object_schema({
    'id': TEXT,
    'category': {'type': 'string', 'enum': list(CHECKS)},
    'priority': {'type': 'string', 'enum': ['blocking', 'improve', 'optional']},
    **{key: TEXT for key in ('location', 'problem', 'requested_change', 'acceptance')},
})
REVIEW_SCHEMA = object_schema({
    'draft_sha256': TEXT,
    'checks': object_schema({key: object_schema({'passed': {'type': 'boolean'}, 'evidence': TEXT})
                             for key in CHECKS}),
    'findings': {'type': 'array', 'items': FINDING_SCHEMA},
    'summary': TEXT,
})


def validate_shape(value, schema):
    kind = schema['type']
    if kind == 'object':
        if not isinstance(value, dict) or set(value) != set(schema['required']):
            raise ValueError('模型结果字段不符合阶段 schema')
        for key, child in schema['properties'].items():
            validate_shape(value[key], child)
    elif kind == 'array':
        if not isinstance(value, list):
            raise ValueError('模型结果必须为数组')
        for child in value:
            validate_shape(child, schema['items'])
    elif kind == 'boolean':
        if not isinstance(value, bool):
            raise ValueError('复核结果必须为布尔值')
    elif kind == 'string':
        if not isinstance(value, str) or not value.strip():
            raise ValueError('模型结果包含空字符串')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError('模型结果包含无效枚举值')


def output_path(out, relative):
    path = out / relative
    if not path.resolve().is_relative_to(out.resolve()):
        raise ValueError('阶段文件不能离开 output/')
    if any(part.is_symlink() for part in [path, *path.parents] if part != out.parent):
        raise ValueError('阶段文件不能使用符号链接')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def save(out, relative, value):
    path = output_path(out, relative)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return path


def digest(result):
    return hashlib.sha256(result['report_markdown'].encode()).hexdigest()


def stage_instructions(stage):
    source = (ROOT / COMMON).read_text(encoding='utf-8')
    start, end = f'<!-- writing-stage:{stage}:start -->', f'<!-- writing-stage:{stage}:end -->'
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError('写作阶段提示词标记缺失或重复')
    body = source.split(start)[1].split(end)[0].strip()
    if not body:
        raise ValueError('写作阶段提示词为空')
    return body


class CodexExecutor:
    def __init__(self, out, time_budget=TIME_BUDGET):
        self.out = out
        self.deadline = time.monotonic() + time_budget
        self.attempts = {}

    def __call__(self, phase, prompt, schema):
        remaining = int(self.deadline - time.monotonic())
        reserved = PHASE_TIMEOUTS['review'] if phase.startswith('revise-') else 0
        if remaining <= 0:
            raise WritingBudgetError(phase, remaining, reserved)
        if remaining <= reserved:
            raise WritingBudgetError(phase, remaining, reserved)
        schema_path = save(self.out, 'stage-schema.json', schema)
        result_path = output_path(self.out, 'stage-result.json')
        result_path.unlink(missing_ok=True)
        phase_limit = PHASE_TIMEOUTS.get(phase.split('-')[0], TIME_BUDGET)
        log_dir = Path(os.environ.get('RUNNER_TEMP', '/tmp'))
        self.attempts[phase] = self.attempts.get(phase, 0) + 1
        attempt = self.attempts[phase]
        run_codex(prompt, output=result_path, schema=schema_path, cwd=ROOT,
                  timeout=min(remaining - reserved, phase_limit),
                  permissions=os.environ['AUTOMATION_PERMISSION_CONFIG'], search='live',
                  exclude=['AUTOMATION_*'], stage=phase, attempt=attempt,
                  stdout_log=log_dir / f'automation-{phase}-{attempt}.log',
                  stderr_log=log_dir / f'automation-{phase}-{attempt}.err')
        path = output_path(self.out, 'stage-result.json')
        if path.stat().st_size > 2_000_000:
            raise ValueError('阶段结果超过大小限制')
        value = json.loads(path.read_text(encoding='utf-8'))
        validate_shape(value, schema)
        return value


def review_ready(review, candidate):
    validate_shape(review, REVIEW_SCHEMA)
    if review['draft_sha256'] != digest(candidate):
        raise ValueError('审稿意见没有绑定当前稿件')
    identifiers = [item['id'] for item in review['findings']]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError('审稿问题 ID 重复')
    for key in CHECKS:
        if not review['checks'][key]['passed'] and not any(
                item['category'] == key and item['priority'] != 'optional' for item in review['findings']):
            raise ValueError('未通过的检查缺少具体修改意见')
    return (all(review['checks'][key]['passed'] for key in CHECKS)
            and not any(item['priority'] != 'optional' for item in review['findings']))


def execute(task_id, out, executor):
    base = output_path(out, 'prompt.md').read_text(encoding='utf-8')
    if task_id == 'weekly-reading-review':
        result = reading_review_preflight(out)
        if result is not None:
            validate_result({'id': task_id}, result, out)
            save(out, 'result.json', result)
            return result
    if task_id not in WRITING_TASKS:
        result = executor('task', base, SCHEMA)
        validate_shape(result, SCHEMA)
        save(out, 'result.json', result)
        return result

    instructions = {stage: stage_instructions(stage) for stage in ('draft', 'review', 'revise')}
    goal = {
        'task_id': task_id, 'max_revisions': MAX_REVISIONS, 'time_budget_seconds': WRITING_TIME_BUDGET,
        'phase_timeout_seconds': PHASE_TIMEOUTS,
        'objective': '形成回答一个明确问题、证据可追溯、清楚易读的完整待审稿；不写入网站',
        'criteria': ['关键事实有来源且不超出证据', '机制与推导完整',
                     '术语、例子与段落服务读者理解', '保留作者观点、重要细节、引用与适用边界'],
        'state': 'drafting', 'selected_version': None, 'stop_reason': '',
        'active_phase': None, 'phase_runs': [],
        'instructions_sha256': hashlib.sha256(
            (base + json.dumps(instructions, ensure_ascii=False, sort_keys=True)).encode()).hexdigest(),
    }
    versions, reviews, parents = [], [], [None]
    deadline = getattr(executor, 'deadline', time.monotonic() + WRITING_TIME_BUDGET)
    brief = None

    def checkpoint():
        save(out, 'writing/goal.json', goal)
        if brief:
            save(out, 'writing/brief.json', brief)
        for index, version in enumerate(versions):
            save(out, f'writing/draft-{index}.json', version)
            output_path(out, f'writing/draft-{index}.md').write_text(version['report_markdown'], encoding='utf-8')
        for index, review in enumerate(reviews):
            save(out, f'writing/review-{index}.json', review)

    def finish(result, state, reason, selected=None):
        goal.update(state=state, stop_reason=reason, selected_version=selected)
        result = json.loads(json.dumps(result))
        if state == 'ready':
            result['audit']['summary'] += f'；完成 {len(reviews)} 次模型审稿、{len(versions) - 1} 轮修订，等待本人确认。'
        checkpoint()
        save(out, 'result.json', result)
        return result

    def call_phase(phase, prompt, schema):
        reserve = ((MAX_REVISIONS - int(phase.split('-')[1])) *
                   (PHASE_TIMEOUTS['revise'] + PHASE_TIMEOUTS['review'])) if phase.startswith('review-') else 0
        for attempt in (1, 2):
            try:
                return call_attempt(phase, prompt, schema, attempt)
            except subprocess.TimeoutExpired:
                remaining = deadline - time.monotonic()
                if not phase.startswith('review-') or attempt == 2 or remaining < PHASE_TIMEOUTS['review'] + reserve:
                    raise
                goal['retry_reason'] = 'review_timeout_with_remaining_budget'
                checkpoint()
                print(f'[writing] retry {phase}; remaining={remaining:.0f}s; reserved={reserve}s', flush=True)

    def call_attempt(phase, prompt, schema, attempt):
        goal['active_phase'] = phase
        checkpoint()
        started = time.monotonic()
        record = {'phase': phase, 'attempt': attempt, 'remaining_seconds': max(0, round(deadline - started)),
                  'retry_reason': 'phase_timeout' if attempt > 1 else None,
                  'limit_seconds': PHASE_TIMEOUTS[phase.split('-')[0]]}
        try:
            value = executor(phase, prompt, schema)
            record['status'] = 'completed'
            return value
        except (TimeoutError, subprocess.TimeoutExpired) as error:
            record['status'] = 'budget_exhausted' if isinstance(error, WritingBudgetError) else 'timed_out'
            if isinstance(error, subprocess.TimeoutExpired):
                record['timeout_seconds'] = error.timeout
            if isinstance(error, WritingBudgetError):
                record.update(remaining_seconds=error.remaining, reserved_review_seconds=error.reserved)
            raise
        except Exception:
            record['status'] = 'failed'
            raise
        finally:
            record['elapsed_seconds'] = round(time.monotonic() - started, 1)
            goal['phase_runs'].append(record)
            checkpoint()

    checkpoint()
    try:
        draft = call_phase('draft', base + '\n\n' + instructions['draft'],
                         DRAFT_SCHEMA)
        validate_shape(draft, DRAFT_SCHEMA)
        brief, result = draft['brief'], draft['result']
        validate_result({'id': task_id}, result, out)
        versions.append(result)
        checkpoint()
        if result['status'] != 'completed':
            return finish(result, result['status'], '原任务没有形成可审阅的新稿')

        candidate = 0
        for round_number in range(MAX_REVISIONS + 1):
            goal['state'] = 'reviewing'
            checkpoint()
            current = versions[candidate]
            previous = (f'上次意见为 output/writing/review-{len(reviews) - 1}.json；'
                        '核对问题是否解决，并与上一版比较是否丢失证据或引入错误。' if reviews else '')
            if parents[candidate] is not None:
                previous += f'本版编辑基线为 output/writing/draft-{parents[candidate]}.json，必须核对重要内容是否保留。'
            review = call_phase(f'review-{round_number}', base + '\n\n' + instructions['review'] + '\n' +
                              f'读取 output/writing/brief.json、output/writing/draft-{candidate}.json。'
                              f'返回 draft_sha256={digest(current)}。{previous}', REVIEW_SCHEMA)
            ready = review_ready(review, current)
            reviews.append(review)
            checkpoint()
            if ready:
                return finish(current, 'ready', '当前稿件通过具体问题复核，等待本人审阅', candidate)
            if round_number == MAX_REVISIONS:
                break

            # A revision that loses substantive content is not the next editing baseline.
            if not review['checks']['preservation']['passed'] and candidate > 0:
                candidate -= 1
            goal['state'] = 'revising'
            checkpoint()
            revised = call_phase(f'revise-{round_number + 1}', base + '\n\n' + instructions['revise'] + '\n' +
                               f'写作目标在 output/writing/brief.json；编辑基线为 output/writing/draft-{candidate}.json；'
                               f'本轮意见为 output/writing/review-{len(reviews) - 1}.json。', SCHEMA)
            validate_shape(revised, SCHEMA)
            validate_result({'id': task_id}, revised, out)
            versions.append(revised)
            parents.append(candidate)
            checkpoint()
            if revised['status'] != 'completed':
                blocked = revised if revised['status'] == 'blocked' else blocked_result(
                    versions[0], '修订不能用 no_update 替代尚未解决的审稿问题')
                return finish(blocked,
                              'blocked', '修订无法形成可复核的完整稿')
            if digest(revised) == digest(versions[candidate]):
                return finish(blocked_result(versions[0], '审稿仍有实质问题，但修订没有改变正文'),
                              'stalled', '修订未取得进展')
            candidate = len(versions) - 1
            checkpoint()

        outstanding = [f"- {item['location']}：{item['problem']}" for item in reviews[-1]['findings']
                       if item['priority'] != 'optional']
        return finish(blocked_result(versions[0], '达到两轮修订上限，当前稿件仍有问题：\n' + '\n'.join(outstanding)),
                      'blocked', '达到修订上限不代表通过')
    except (TimeoutError, subprocess.TimeoutExpired) as error:
        phase = goal['active_phase'] or 'draft'
        labels = {'draft': '初稿', 'review': '审稿', 'revise': '修订'}
        label = labels[phase.split('-')[0]]
        limit = getattr(error, 'timeout', PHASE_TIMEOUTS[phase.split('-')[0]])
        reason = (f'{phase} {label}阶段时间预算不足：剩余 {max(0, error.remaining)} 秒，'
                  f'需为后续复核保留 {error.reserved} 秒。' if isinstance(error, WritingBudgetError) else
                  f'{phase} {label}阶段达到 {limit} 秒时间预算，未完成稿件复核。')
        latest = versions[-1] if versions else None
        result = blocked_result(latest, reason)
        topic = (latest['report_markdown'].splitlines()[0].lstrip('# ').strip() if latest else
                 {'security-event-research': '安全事件研究', 'ai-security-frontier-research': 'AI 安全前沿研究',
                  'ai-coding-rd-efficiency': 'AI 编程与研发提效',
                  'security-architecture-defense': '安全架构与防御创新'}[task_id])
        result['report_markdown'] = result['report_markdown'].replace(
            '# 研究稿尚未完成复核', f'# {topic[:150]}：{label}未完成', 1)
        result['report_markdown'] += f'\n\n已保留 {len(versions)} 版完整稿件、{len(reviews)} 次审稿记录；均未写入网站。'
        if reviews:
            findings = [item for item in reviews[-1]['findings'] if item['priority'] != 'optional']
            if findings:
                result['report_markdown'] += '\n\n最近一轮审稿意见（是否已解决仍待完整复核）：\n' + '\n'.join(
                    f"- {item['location']}：{item['problem']}" for item in findings)
        diagnostic = {'version': 1, 'task_id': task_id, 'stage': phase,
                      'error_code': 'writing_budget_exhausted' if isinstance(error, WritingBudgetError) else 'writing_phase_timeout',
                      'timeout_seconds': limit, 'draft_count': len(versions), 'review_count': len(reviews)}
        print('ACTION_DIAGNOSTIC ' + json.dumps(diagnostic, ensure_ascii=False))
        return finish(result, 'blocked', reason)
    except Exception:
        goal.update(state='failed', stop_reason='阶段执行或结果校验失败；未交付未经复核的稿件')
        checkpoint()
        raise


def blocked_result(initial, reason):
    note = ('已有稿件与审稿记录保留在本次 Actions 写作附件，尚未写入网站。' if initial else
            '尚未形成完整初稿；目标状态保留在本次 Actions 写作附件，尚未写入网站。')
    return {
        'status': 'blocked',
        'report_markdown': '# 研究稿尚未完成复核\n\n' + reason + '\n\n' + note,
        'sources': initial['sources'] if initial else [], 'artifacts': [],
        'audit': {'summary': reason,
                  'data_cutoff': initial['audit']['data_cutoff'] if initial else '未完成来源核验',
                  'deduplication_reason': initial['audit']['deduplication_reason'] if initial else '未完成历史比较'},
    }


def main():
    if Path.cwd().resolve() != ROOT.resolve():
        raise ValueError('执行目录必须为仓库根目录')
    for key in ('TASK_ID', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'AUTOMATION_PERMISSION_CONFIG'):
        if not os.environ.get(key):
            raise ValueError(f'缺少执行配置 {key}')
    out = ROOT / 'output'
    task_id = os.environ['TASK_ID']
    budget = WRITING_TIME_BUDGET if task_id in WRITING_TASKS else TIME_BUDGET
    result = execute(task_id, out, CodexExecutor(out, time_budget=budget))
    print(f"任务执行完成：{result['status']}")


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'任务执行失败：{type(error).__name__}；阶段日志保留在 runner 临时目录', file=sys.stderr)
        sys.exit(1)
