"""Read narrowly associated input and replay known parser rules without executing repository code."""
import ast
import hashlib
import re
import unicodedata

SLEEP_WORKFLOW = '.github/workflows/import-sleep-score.yml'
SLEEP_PARSER = 'scripts/import_sleep_score_issue.py'
LEGACY_PATTERN = r'^\s*(\d{1,3})\s*$'


def parser_probe(body, source):
    result = {'method': 'fixed_rule_replay', 'state': 'not_verified',
              'detail': '未执行目标提交的代码或原 workflow。'}
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return result
    function = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'parse_issue'), None)
    if function is None:
        return result
    extractor = any(isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'totals' for t in node.targets)
                    and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute)
                    and isinstance(node.value.func.value, ast.Name) and node.value.func.value.id == 're'
                    and node.value.func.attr == 'findall' and len(node.value.args) >= 2
                    and isinstance(node.value.args[0], ast.Constant) and node.value.args[0].value == LEGACY_PATTERN
                    and isinstance(node.value.args[1], ast.Name) and node.value.args[1].id == 'text'
                    for node in ast.walk(function))
    if not extractor:
        return result
    text = unicodedata.normalize('NFKC', body).replace('\r\n', '\n')
    all_candidates = re.findall(LEGACY_PATTERN, text, re.M)
    panel = re.split(r'^[ \t]*睡眠[ \t]*$', text, maxsplit=1, flags=re.M)[0]
    candidates = re.findall(r'^[ \t]*(\d{1,3})[ \t]*$', panel, re.M)
    components = []
    for label, maximum in (('时长', 50), ('就寝', 30), ('中断', 20)):
        values = re.findall(label + r'\s*[:：]\s*(\d+)\s*/\s*(\d+)', text)
        if len(values) != 1 or int(values[0][1]) != maximum or not 0 <= int(values[0][0]) <= maximum:
            return result
        components.append(int(values[0][0]))
    if len(all_candidates) > 1 and len(candidates) == 1 and int(candidates[0]) == sum(components):
        result.update(state='mechanism_reproduced', candidate_count=len(all_candidates),
                      panel_candidate_count=1, component_sum_matches=True,
                      detail='失败提交的提取表达式会把评分区外数字也计入总分候选；限定评分区后仅有一个候选，且与有效分项之和一致。')
    return result


def associated_inputs(repo, run, references, sources, api):
    # Each adapter is bound to a known workflow; log text cannot request arbitrary Issues.
    if run['path'].split('@')[0] != SLEEP_WORKFLOW:
        return [], []
    inputs, checks = [], []
    for reference in references[:3]:
        number = reference.get('issue_number')
        if type(number) is not int or not 1 <= number <= 2**53:
            continue
        try:
            issue = api(f'repos/{repo}/issues/{number}')
        except RuntimeError:
            inputs.append({'issue_number': number, 'availability': 'unavailable'})
            continue
        if (issue.get('pull_request') or issue.get('title') != '睡眠评分'
                or issue.get('user', {}).get('login', '').lower() != repo.split('/')[0].lower()
                or issue.get('created_at', '') > run.get('updated_at', '')):
            continue
        body = issue.get('body') or ''
        if not body or len(body.encode()) > 100_000:
            inputs.append({'issue_number': number, 'availability': 'empty_or_too_large'})
            continue
        digest = hashlib.sha256(body.encode()).hexdigest()
        expected = reference.get('body_sha256')
        version = 'matched' if expected == digest else 'changed' if expected else 'historical_version_unknown'
        inputs.append({'issue_number': number, 'url': f'https://github.com/{repo}/issues/{number}',
                       'availability': 'available', 'input_version': version,
                       'note': '只提供固定规则验证摘要，不复制 OCR 原文。'})
        if version == 'changed':
            checks.append({'issue_number': number, 'state': 'input_changed',
                           'detail': '原输入已修改，停止针对当前输入验证历史失败。'})
            continue
        check = parser_probe(body, sources.get(SLEEP_PARSER, ''))
        check.update(issue_number=number, input_version=version)
        checks.append(check)
    return inputs, checks
