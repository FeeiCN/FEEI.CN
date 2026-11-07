"""Build an evidence-backed RDF graph and static explorer data from compliance sources."""

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import quote

import rdflib
from pyshacl import validate
from rdflib import Graph, Literal, Namespace, RDF, RDFS, URIRef

from index_compliance_documents import collect


SITE = Path(__file__).resolve().parent.parent
CONFIG = SITE / 'config/compliance-ontology'
OUTPUT = SITE / 'static/data/compliance'
C = Namespace('https://feei.cn/ontology/compliance#')
K = Namespace('https://feei.cn/knowledge/compliance/')
STANDARD = re.compile(
    r'(?<![\w/])(?P<prefix>GB\s*(?:/\s*[TZ])?|G[AM]\s*/\s*T)\s*'
    r'(?P<number>\d+(?:\.\d+)*)(?:\s*[—–－-]\s*(?P<year>\d{4}))?(?![\w.])'
)
HEADING = re.compile(r'^(#{1,6})\s+(.+?)\s*#*\s*$')
CLAUSE = re.compile(r'^(\d+(?:\.\d+)*|[A-Z]\.\d+(?:\.\d+)*)\s+(.+)')
REPLACEMENT = re.compile(r'^本(?:文件|标准)(?:从实施之日起[，,]?\s*)?\s*(?:代替|替代)\s*')
ROLES = {'source-text', 'source-reader', 'analysis', 'topic-guide'}
PREDICATES = {'cites', 'normativelyReferences', 'supersedes', 'hasVersion', 'presents',
              'transcribes', 'discusses', 'includes', 'isPartOf', 'enactedUnder', 'implements'}
LEGAL_TITLE = re.compile(r'(?:法|条例|办法|规定|指引|规则)(?:[（(].*?[）)])?$')
BOOK_TITLE = re.compile(r'《([^《》]+)》')


def legal_names(nodes, edges):
    candidates = {}

    def add(name, identifier):
        candidates.setdefault(re.sub(r'\s+', '', name), set()).add(identifier)

    for node in nodes.values():
        if (node['type'] == 'Document' and node.get('role') not in {'source-text', 'topic-guide'}
                and not node.get('topic', '').startswith('10-')
                and LEGAL_TITLE.search(node['label']) and not STANDARD.search(node['label'])):
            add(node['label'], node['id'])
            if node['label'].startswith('中华人民共和国'):
                add(node['label'][7:], node['id'])
    legal_ids = {identifier for ids in candidates.values() for identifier in ids}
    for edge in edges:
        if edge['predicate'] == 'includes' and edge['subject'] in legal_ids:
            add(nodes[edge['object']]['label'], edge['subject'])
    return {name: next(iter(ids)) for name, ids in candidates.items() if len(ids) == 1}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def standard_name(match):
    prefix = re.sub(r'\s+', '', match['prefix'])
    return prefix + ' ' + match['number'] + ('-' + match['year'] if match['year'] else '')


def standard_key(name):
    return name.lower().replace('/', '-').replace(' ', '-')


def document_id(entry):
    if entry['role'] == 'source-text':
        key = standard_key(entry['standard']) if entry.get('standard') else digest(Path(entry['path']).stem)[:20]
        return 'source:' + key
    return 'document:' + entry['slug'].strip('/')


def body_lines(source):
    """Keep original line numbers while excluding front matter, code and comments."""
    front = source.startswith('---\n') or source.startswith('---\r\n')
    fence = None
    comment = False
    for number, raw in enumerate(source.splitlines(), 1):
        if front:
            if number > 1 and raw.strip() == '---':
                front = False
            continue
        marker = re.match(r'^\s*(`{3,}|~{3,})', raw)
        if marker:
            if fence is None:
                fence = marker[1][0]
            elif marker[1][0] == fence:
                fence = None
            continue
        if fence:
            continue
        if comment:
            if '-->' in raw:
                comment = False
            continue
        if '<!--' in raw:
            if '-->' not in raw:
                comment = True
            continue
        clean = re.sub(r'`[^`]*`|<[^>]*>|!\[[^\]]*\]\([^)]*\)', '', raw)
        yield number, raw, clean


class Builder:
    def __init__(self):
        self.nodes = {}
        self.edges = {}
        self.evidence = {}
        self.lines = {}
        self.path_ids = {}
        self.legal_names = {}

    def node(self, node_id, kind, label, **properties):
        existing = self.nodes.get(node_id)
        if existing and existing['type'] != kind:
            raise ValueError(f'Conflicting identity: {node_id}')
        self.nodes[node_id] = {**(existing or {}), 'id': node_id, 'type': kind,
                                  'label': label, **properties}
        return node_id

    def evidence_at(self, doc, line, text, focus=None, limit=320):
        if limit and len(text) > limit:
            position = max(0, text.find(focus) - 90) if focus else 0
            text = text[position:position + limit]
        item = {'document': doc, 'line': line, 'quote': text.strip()}
        identifier = 'evidence:' + digest(encode(item))[:24]
        self.evidence[identifier] = {'id': identifier, **item}
        return identifier

    def edge(self, subject, predicate, target, evidence):
        key = (subject, predicate, target)
        if key not in self.edges:
            self.edges[key] = {'id': 'assertion:' + digest(encode(key))[:24],
                               'subject': subject, 'predicate': predicate, 'object': target,
                               'evidence': []}
        if evidence not in self.edges[key]['evidence']:
            self.edges[key]['evidence'].append(evidence)

    def standard(self, match, evidence):
        name = standard_name(match)
        series_name = name.rsplit('-', 1)[0] if match['year'] else name
        series = 'series:' + standard_key(series_name)
        self.node(series, 'StandardSeries', series_name, identifier=series_name)
        if not match['year']:
            return series
        version = 'standard:' + standard_key(name)
        self.node(version, 'StandardVersion', self.nodes.get(version, {}).get('label', name),
                  identifier=name, series=series)
        self.edge(series, 'hasVersion', version, evidence)
        return version

    def add_documents(self, index, root):
        entries = index['documents']
        for entry in entries:
            identifier = document_id(entry)
            if identifier in self.nodes:
                raise ValueError(f'Duplicate document identity: {entry["path"]}')
            path = root / entry['path']
            source = path.read_text()
            self.path_ids[path.resolve()] = identifier
            self.lines[identifier] = source.splitlines()
            label = entry['title']
            if entry['role'] == 'source-text' and not entry.get('standard'):
                label = Path(entry['path']).stem.lstrip('_').removesuffix('原文')
            source_form = 'transcription' if entry.get('standard') and entry['role'] == 'source-text' else None
            if entry['role'] == 'source-text' and not source_form:
                source_form = 'outline' if '条款结构速查' in source else 'excerpt'
            self.node(identifier, 'Document', label, role=entry['role'], sourceForm=source_form,
                      path=path.relative_to(SITE).as_posix(), sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      topic=entry['topic'], url=entry.get('slug'),
                      sourceUrl=entry.get('source_url'))
        for entry in entries:
            doc = document_id(entry)
            source = '\n'.join(self.lines[doc])
            own_match = STANDARD.search(entry.get('standard') or entry['title'])
            if own_match:
                own_name = standard_name(own_match)
                line = next((i for i, text in enumerate(self.lines[doc], 1)
                             if any(standard_name(m) == own_name for m in STANDARD.finditer(text))), 1)
                ev = self.evidence_at(doc, line, self.lines[doc][line - 1])
                own = self.standard(own_match, ev)
                predicate = {'source-text': 'transcribes', 'source-reader': 'presents'}.get(entry['role'], 'discusses')
                self.edge(doc, predicate, own, ev)
                if entry['role'] == 'source-text':
                    self.nodes[own]['label'] = entry['title']
            for line, raw in enumerate(self.lines[doc], 1):
                include = re.search(r'<!--\s*@include\s+(\S+)\s*-->', raw)
                if include:
                    target = self.path_ids.get((root / entry['path']).parent.joinpath(include[1]).resolve())
                    if target is None:
                        raise ValueError(f'Include has no indexed source: {entry["path"]}:{line}')
                    self.edge(doc, 'includes', target, self.evidence_at(doc, line, raw))
        self.legal_names = legal_names(self.nodes, self.edges.values())
        return entries

    def add_legal_relations(self, config):
        if config.get('schemaVersion') != 1:
            raise ValueError('Unsupported legal relationship schema')
        for statement in config['statements']:
            doc, line, quote = statement['document'], statement['line'], statement['quote']
            predicate, targets = statement['predicate'], statement['targets']
            source = self.nodes.get(doc, {})
            if source.get('role') != 'source-text' or source.get('topic', '').startswith('10-'):
                raise ValueError('Legal relationships require an indexed original source')
            if not isinstance(line, int) or not 1 <= line <= len(self.lines[doc]) or self.lines[doc][line - 1] != quote:
                raise ValueError(f'Legal relationship evidence changed: {doc}:{line}')
            if not any(number == line for number, _, _ in body_lines('\n'.join(self.lines[doc]))):
                raise ValueError('Legal relationship evidence cannot be metadata, comments or code')
            relation = 'transcribes' if predicate == 'implements' else 'includes'
            subjects = {edge['object'] if relation == 'transcribes' else edge['subject']
                        for edge in self.edges.values() if edge['predicate'] == relation
                        and (edge['subject'] if relation == 'transcribes' else edge['object']) == doc}
            if predicate not in {'enactedUnder', 'implements'} or len(subjects) != 1 or not targets:
                raise ValueError(f'Invalid legal relationship subject: {doc}')
            subject = next(iter(subjects))
            mentioned = {self.legal_names.get(re.sub(r'\s+', '', title)) for title in BOOK_TITLE.findall(quote)}
            if predicate == 'enactedUnder' and not re.search(r'根据.+制定本(?:法|条例|办法|规定)', quote):
                raise ValueError('Enactment needs an explicit self-formulation statement')
            if predicate == 'implements' and not re.search(r'为了?配合|为(?:贯彻(?:执行|落实)?|落实)|本(?:文件|标准).{0,40}根据|^依据', quote):
                raise ValueError('Implementation needs an explicit original-source implementation statement')
            for target in targets:
                if target == subject or target not in mentioned:
                    raise ValueError(f'Legal relationship target is not explicitly named: {target}')
                title = next(title for title in BOOK_TITLE.findall(quote)
                             if self.legal_names.get(re.sub(r'\s+', '', title)) == target)
                self.edge(subject, predicate, target, self.evidence_at(doc, line, quote, title, limit=None))

    def extract(self, entry, pilot):
        doc = document_id(entry)
        source = '\n'.join(self.lines[doc])
        own_match = STANDARD.search(entry.get('standard', ''))
        own = 'standard:' + standard_key(standard_name(own_match)) if own_match else None
        is_original = entry['role'] == 'source-text'
        subject = own if own and is_original else doc
        section = ''
        annex = None
        clauses = set()
        for line, raw, clean in body_lines(source):
            heading = HEADING.match(clean)
            if heading and len(heading[1]) <= 2:
                section = heading[2]
                annex_match = re.match(r'^附录\s*([A-Z])', section)
                if annex_match:
                    annex = annex_match[1]
            clause = CLAUSE.match(heading[2]) if heading else None
            if own and is_original and entry.get('standard') in pilot and clause:
                number, title = clause.groups()
                section_kind = 'appendix' if annex else 'body'
                if annex and number[0].isdigit():
                    number = annex + '/template/' + number
                    section_kind = 'template'
                if number in clauses:
                    raise ValueError(f'Duplicate clause {entry["standard"]} {number}')
                clauses.add(number)
                identifier = 'clause:' + standard_key(entry['standard']) + ':' + number
                preview = []
                for next_line in self.lines[doc][line:line + 12]:
                    if HEADING.match(next_line):
                        break
                    text = re.sub(r'<[^>]*>|!\[[^\]]*\]\([^)]*\)', '', next_line).strip()
                    if text:
                        preview.append(text)
                self.node(identifier, 'Clause', f'{number} {title}', number=number,
                          standard=own, document=doc, line=line,
                          preview=' '.join(preview)[:240], topic=entry['topic'], sectionKind=section_kind)
                self.edge(identifier, 'isPartOf', own, self.evidence_at(doc, line, raw))
            # A new edition is never inferred from a later year or a shared number.
            replacement = REPLACEMENT.match(clean.strip()) if own and is_original else None
            replacement_end = None
            if replacement:
                tail = clean.strip()[replacement.end():]
                replacement_text = re.split(r'[。；;]|[，,]\s*与', tail, maxsplit=1)[0]
                replacement_end = replacement.end() + len(replacement_text)
                for match in STANDARD.finditer(replacement_text):
                    if not match['year']:
                        continue
                    ev = self.evidence_at(doc, line, raw, match[0])
                    target = self.standard(match, ev)
                    if target != own:
                        self.edge(own, 'supersedes', target, ev)
            if heading:
                continue
            if is_original:
                for title in BOOK_TITLE.findall(clean):
                    target = self.legal_names.get(re.sub(r'\s+', '', title))
                    if target and target != subject:
                        self.edge(subject, 'cites', target, self.evidence_at(doc, line, raw, title))
            for match in STANDARD.finditer(clean):
                ev = self.evidence_at(doc, line, raw, match[0])
                target = self.standard(match, ev)
                if target == subject:
                    continue
                if replacement_end is not None and match.start() < replacement_end:
                    continue
                predicate = 'normativelyReferences' if is_original and re.match(r'^2\s+规范性引用文件', section) else 'cites'
                self.edge(subject, predicate, target, ev)
            for link in re.finditer(r'(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)', raw):
                destination = link[1].split('#')[0].split('?')[0]
                target = None
                if destination.startswith('/'):
                    candidate = 'document:' + destination.strip('/')
                    if candidate in self.nodes:
                        target = candidate
                elif destination.endswith(('.md', '.mdx')):
                    path = (SITE / self.nodes[doc]['path']).parent / destination
                    target = self.path_ids.get(path.resolve())
                if target and target != doc:
                    self.edge(subject, 'cites', target, self.evidence_at(doc, line, raw, link[0]))

    def finish(self, source_digest, pilot):
        source_for = {}
        pages_for = {}
        for edge in self.edges.values():
            if edge['predicate'] == 'transcribes':
                source_for.setdefault(edge['object'], []).append(edge['subject'])
            if edge['predicate'] in {'presents', 'discusses'}:
                pages_for.setdefault(edge['object'], []).append(edge['subject'])
        for node in self.nodes.values():
            if node['type'] == 'StandardVersion':
                node['sources'] = sorted(source_for.get(node['id'], []))
                node['pages'] = sorted(pages_for.get(node['id'], []))
        return {'schemaVersion': 1, 'sourceDigest': source_digest,
                'scope': {'indexedDocuments': len(self.lines), 'clauseStandards': sorted(pilot)},
                'nodes': sorted(self.nodes.values(), key=lambda n: n['id']),
                'edges': sorted(self.edges.values(), key=lambda e: e['id']),
                'evidence': sorted(self.evidence.values(), key=lambda e: e['id'])}


def validate_payload(payload, lines):
    nodes = {n['id']: n for n in payload['nodes']}
    evidence = {e['id']: e for e in payload['evidence']}
    if len(nodes) != len(payload['nodes']) or len(evidence) != len(payload['evidence']):
        raise ValueError('Duplicate identities')
    for item in evidence.values():
        text = lines.get(item['document'], [])
        if not 1 <= item['line'] <= len(text) or not item['quote'] or item['quote'] not in text[item['line'] - 1]:
            raise ValueError(f'Untraceable evidence: {item["id"]}')
    seen = set()
    for edge in payload['edges']:
        if edge['subject'] not in nodes or edge['object'] not in nodes:
            raise ValueError(f'Dangling relationship: {edge["id"]}')
        if edge['predicate'] not in PREDICATES or not edge['evidence'] or any(e not in evidence for e in edge['evidence']):
            raise ValueError(f'Invalid assertion: {edge["id"]}')
        triple = (edge['subject'], edge['predicate'], edge['object'])
        if triple in seen:
            raise ValueError('Duplicate relationship')
        seen.add(triple)
        kinds = (nodes[edge['subject']]['type'], nodes[edge['object']]['type'])
        expected = {'supersedes': ('StandardVersion', 'StandardVersion'),
                    'hasVersion': ('StandardSeries', 'StandardVersion'),
                    'isPartOf': ('Clause', 'StandardVersion'),
                    'includes': ('Document', 'Document'),
                    'presents': ('Document', 'StandardVersion'),
                    'transcribes': ('Document', 'StandardVersion')}.get(edge['predicate'])
        if edge['predicate'] in {'enactedUnder', 'implements'}:
            expected = ('Document' if edge['predicate'] == 'enactedUnder' else 'StandardVersion', 'Document')
        if expected and kinds != expected:
            raise ValueError(f'Invalid relationship types: {edge["id"]}')
        if edge['predicate'] == 'supersedes':
            for ev_id in edge['evidence']:
                ev = evidence[ev_id]
                raw = lines[ev['document']][ev['line'] - 1]
                if nodes[ev['document']]['role'] != 'source-text' or not REPLACEMENT.match(raw):
                    raise ValueError('Replacement needs an explicit original-source statement')
        if edge['predicate'] in {'enactedUnder', 'implements'}:
            for ev_id in edge['evidence']:
                ev = evidence[ev_id]
                source_relation = ('transcribes', ev['document'], edge['subject']) if edge['predicate'] == 'implements' else ('includes', edge['subject'], ev['document'])
                if (nodes[ev['document']]['role'] != 'source-text'
                        or not any((e['predicate'], e['subject'], e['object']) == source_relation for e in payload['edges'])):
                    raise ValueError('Legal relationship needs the subject original source')
    return nodes


def uri(identifier):
    return URIRef(str(K) + quote(identifier, safe=':.-'))


def to_rdf(payload):
    graph = Graph()
    graph.bind('c', C)
    graph.bind('k', K)
    graph.bind('rdfs', RDFS)
    graph.bind('rdf', RDF)
    for node in payload['nodes']:
        subject = uri(node['id'])
        graph.add((subject, RDF.type, C[node['type']]))
        graph.add((subject, RDFS.label, Literal(node['label'])))
        for name in ['path', 'sha256', 'role', 'sourceForm', 'sectionKind', 'identifier', 'number', 'url', 'sourceUrl', 'topic']:
            if node.get(name) is not None:
                graph.add((subject, C[name], Literal(node[name])))
    for edge in payload['edges']:
        subject, predicate, target = uri(edge['subject']), C[edge['predicate']], uri(edge['object'])
        graph.add((subject, predicate, target))
        assertion = uri(edge['id'])
        for p, o in [(RDF.type, C.Assertion), (RDF.subject, subject), (RDF.predicate, predicate), (RDF.object, target)]:
            graph.add((assertion, p, o))
        for ev in edge['evidence']:
            graph.add((assertion, C.evidence, uri(ev)))
    for item in payload['evidence']:
        subject = uri(item['id'])
        for predicate, value in [(RDF.type, C.Evidence), (C.document, uri(item['document'])),
                                 (C.line, Literal(item['line'])), (C.quote, Literal(item['quote']))]:
            graph.add((subject, predicate, value))
    return graph


def validate_graph(graph):
    shapes = Graph().parse(CONFIG / 'shapes.ttl')
    conforms, _, report = validate(graph, shacl_graph=shapes, inference='none',
                                   advanced=False, allow_warnings=False)
    if not conforms:
        raise ValueError(str(report))


def build():
    index_path = SITE / 'scripts/data/compliance-document-index.json'
    index = json.loads(index_path.read_text())
    if index != collect():
        raise ValueError('Compliance document index is stale; refresh it before building the ontology')
    pilot = json.loads((CONFIG / 'pilot.json').read_text())['clauseStandards']
    available = {d.get('standard') for d in index['documents'] if d['role'] == 'source-text'}
    if len(pilot) != len(set(pilot)) or not set(pilot) <= available:
        raise ValueError('Pilot standards must be unique and have original source texts')
    builder = Builder()
    entries = builder.add_documents(index, SITE / index['root'])
    for entry in entries:
        builder.extract(entry, set(pilot))
    builder.add_legal_relations(json.loads((CONFIG / 'legal-relations.json').read_text()))
    inputs = {node['path']: node['sha256'] for node in builder.nodes.values() if node['type'] == 'Document'}
    for path in [index_path, *sorted(CONFIG.glob('*')), Path(__file__),
                 SITE / 'scripts/index_compliance_documents.py', SITE / 'scripts/requirements-ontology.txt']:
        inputs[path.relative_to(SITE).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    payload = builder.finish(digest(encode(inputs)), pilot)
    validate_payload(payload, builder.lines)
    graph = to_rdf(payload)
    validate_graph(graph)
    # Sorting inputs and omitting wall-clock timestamps keeps exports reproducible.
    turtle = graph.serialize(format='turtle')
    report = {'schemaVersion': 1, 'sourceDigest': payload['sourceDigest'], 'conforms': True,
              'documents': len(entries), 'clauseStandards': len(pilot),
              'nodes': dict(sorted(Counter(n['type'] for n in payload['nodes']).items())),
              'relationships': dict(sorted(Counter(e['predicate'] for e in payload['edges']).items())),
              'evidence': len(payload['evidence']), 'triples': len(graph),
              'dependencies': {'rdflib': rdflib.__version__, 'pyshacl': __import__('pyshacl').__version__},
              'inputs': dict(sorted(inputs.items()))}
    clause_data = {'schemaVersion': 1, 'sourceDigest': payload['sourceDigest'],
                   'nodes': [n for n in payload['nodes'] if n['type'] == 'Clause'],
                   'edges': [e for e in payload['edges'] if e['predicate'] == 'isPartOf']}
    catalog = {**payload, 'stats': {k: v for k, v in report.items() if k not in {'inputs', 'dependencies'}},
               'nodes': [n for n in payload['nodes'] if n['type'] != 'Clause'],
               'edges': [e for e in payload['edges'] if e['predicate'] != 'isPartOf']}
    del catalog['evidence']
    outputs = {'graph.json': encode(catalog) + '\n', 'graph.ttl': turtle,
               'clauses.json': encode(clause_data) + '\n',
               'evidence.json': encode({'sourceDigest': payload['sourceDigest'], 'evidence': payload['evidence']}) + '\n',
               'model.ttl': (CONFIG / 'model.ttl').read_text(),
               'shapes.ttl': (CONFIG / 'shapes.ttl').read_text()}
    report['exports'] = {name: digest(text) for name, text in outputs.items()}
    outputs['validation.json'] = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate sources and require reproducible current exports')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    outputs = build()
    report = json.loads(outputs['validation.json'])
    for relative, expected in report['inputs'].items():
        if hashlib.sha256((SITE / relative).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Source changed during graph generation: {relative}')
    for name, text in outputs.items():
        path = args.output / name
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise ValueError(f'Stale or missing export: {path.relative_to(SITE) if path.is_relative_to(SITE) else path}')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix(path.suffix + '.tmp')
            temp.write_text(text)
            temp.replace(path)
    print(json.dumps({k: v for k, v in report.items() if k != 'inputs'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
