import copy
import unittest
from pathlib import Path

from rdflib import Graph, RDF

from build_compliance_ontology import (
    Builder, C, REPLACEMENT, STANDARD, body_lines, digest, document_id,
    legal_names, standard_name, to_rdf, uri, validate_graph, validate_payload,
)


def fixture(text, standard='GB/T 12345-2024', role='source-text', pilot=None):
    builder = Builder()
    entry = {'standard': standard, 'role': role, 'path': 'fixture.md',
             'title': standard, 'slug': '/fixture', 'topic': '测试'}
    doc = document_id(entry)
    builder.node(doc, 'Document', standard, path='fixture.md', sha256=digest(text), role=role)
    builder.lines[doc] = text.splitlines()
    ev = builder.evidence_at(doc, 1, text.splitlines()[0])
    builder.standard(STANDARD.search(standard), ev)
    builder.extract(entry, {standard} if pilot is None else pilot)
    payload = builder.finish('0' * 64, [standard])
    return builder, payload


class ComplianceOntologyTests(unittest.TestCase):
    def legal_fixture(self, text='第一条 根据《中华人民共和国网络安全法》，制定本办法。'):
        builder = Builder()
        for identifier, label, role in [('document:measure', '测试管理办法', 'analysis'),
                                         ('document:law', '中华人民共和国网络安全法', 'analysis'),
                                         ('source:measure', '测试管理办法', 'source-text')]:
            builder.node(identifier, 'Document', label, role=role, path=identifier + '.md', sha256=digest(text))
            builder.lines[identifier] = text.splitlines()
        builder.edge('document:measure', 'includes', 'source:measure', builder.evidence_at('document:measure', 1, text))
        builder.legal_names = legal_names(builder.nodes, builder.edges.values())
        statement = {'document': 'source:measure', 'line': 1, 'quote': text,
                     'predicate': 'enactedUnder', 'targets': ['document:law']}
        return builder, {'schemaVersion': 1, 'statements': [statement]}

    def test_reviewed_enactment_uses_original_and_points_from_measure_to_law(self):
        builder, config = self.legal_fixture()
        builder.add_legal_relations(config)
        payload = builder.finish('0' * 64, [])
        edge = next(e for e in payload['edges'] if e['predicate'] == 'enactedUnder')
        self.assertEqual((edge['subject'], edge['object']), ('document:measure', 'document:law'))
        self.assertEqual(builder.evidence[edge['evidence'][0]]['document'], 'source:measure')
        validate_payload(payload, builder.lines)
        validate_graph(to_rdf(payload))

    def test_changed_quote_wrong_target_analysis_and_ordinary_citation_cannot_be_enactment(self):
        for change, message in [({'quote': '根据另一部法律制定。'}, 'evidence changed'),
                                 ({'line': 2}, 'evidence changed'),
                                 ({'targets': ['document:unknown']}, 'not explicitly named'),
                                 ({'document': 'document:measure'}, 'original source')]:
            builder, config = self.legal_fixture()
            config['statements'][0].update(change)
            with self.assertRaisesRegex(ValueError, message):
                builder.add_legal_relations(config)
        builder, config = self.legal_fixture('第一条 相关业务可参见《中华人民共和国网络安全法》。')
        with self.assertRaisesRegex(ValueError, 'self-formulation'):
            builder.add_legal_relations(config)

    def test_code_or_comment_cannot_supply_legal_statement_even_when_quote_matches(self):
        for text, line in [('<!-- 根据《中华人民共和国网络安全法》，制定本办法。 -->', 1),
                            ('```text\n根据《中华人民共和国网络安全法》，制定本办法。\n```', 2)]:
            builder, config = self.legal_fixture(text)
            config['statements'][0].update(line=line, quote=text.splitlines()[line - 1])
            with self.assertRaisesRegex(ValueError, 'metadata, comments or code'):
                builder.add_legal_relations(config)

    def test_exact_legal_names_resolve_but_ambiguous_titles_are_not_guessed(self):
        builder, _ = self.legal_fixture()
        self.assertEqual(builder.legal_names['网络安全法'], 'document:law')
        builder.node('document:other-law', 'Document', '网络安全法', role='analysis')
        self.assertNotIn('网络安全法', legal_names(builder.nodes, builder.edges.values()))

    def test_unreviewed_standard_mentions_are_citations_and_never_implementation_claims(self):
        builder, config = self.legal_fixture()
        entry = {'standard': 'GB/T 12345-2024', 'role': 'source-text', 'path': 'standard.md'}
        doc = document_id(entry)
        explicit = '为落实《中华人民共和国网络安全法》要求，' + '补充说明，' * 80 + '制定本标准。'
        text = '## 引言\n参见《中华人民共和国网络安全法》。\n' + explicit
        builder.node(doc, 'Document', '标准原文', role='source-text', path='standard.md', sha256=digest(text))
        builder.lines[doc] = text.splitlines()
        ev = builder.evidence_at(doc, 2, text.splitlines()[1])
        version = builder.standard(STANDARD.search(entry['standard']), ev)
        builder.edge(doc, 'transcribes', version, ev)
        builder.extract(entry, set())
        self.assertIn((version, 'cites', 'document:law'), builder.edges)
        self.assertFalse(any(e['predicate'] == 'implements' for e in builder.edges.values()))
        statement = {'document': doc, 'line': 2, 'quote': text.splitlines()[1],
                     'predicate': 'implements', 'targets': ['document:law']}
        with self.assertRaisesRegex(ValueError, 'implementation statement'):
            builder.add_legal_relations({'schemaVersion': 1, 'statements': [statement]})
        statement['line'] = 3
        statement['quote'] = explicit
        builder.add_legal_relations({'schemaVersion': 1, 'statements': [statement]})
        edge = builder.edges[(version, 'implements', 'document:law')]
        self.assertEqual(builder.evidence[edge['evidence'][0]]['quote'], explicit)
        validate_payload(builder.finish('0' * 64, []), builder.lines)

    def test_standard_identity_keeps_prefix_year_and_part(self):
        for raw, expected in [('GB / T 20274.1—2023', 'GB/T 20274.1-2023'),
                              ('GB/Z 20986—2007', 'GB/Z 20986-2007'),
                              ('GM/T 0005—2021', 'GM/T 0005-2021'),
                              ('GB 11643-1999', 'GB 11643-1999')]:
            self.assertEqual(standard_name(STANDARD.search(raw)), expected)

    def test_code_comments_and_frontmatter_are_not_assertions(self):
        text = '---\ntitle: GB/T 22222-2020\n---\n```text\nGB/T 33333-2020\n```\n<!-- GB/T 44444-2020 -->\n正文 GB/T 55555-2020\n'
        found = [(line, standard_name(m)) for line, _, clean in body_lines(text) for m in STANDARD.finditer(clean)]
        self.assertEqual(found, [(8, 'GB/T 55555-2020')])

    def test_normative_references_are_scoped_to_section_two(self):
        _, payload = fixture('# GB/T 12345-2024\n## 前言\n依据 GB/T 11111-2020\n## 2 规范性引用文件\n- GB/T 22222-2018\n- GB/T 33333\n## 3 术语和定义\n参见 GB/T 44444-2019')
        normative = [e['object'] for e in payload['edges'] if e['predicate'] == 'normativelyReferences']
        self.assertCountEqual(normative, ['standard:gb-t-22222-2018', 'series:gb-t-33333'])
        self.assertNotIn('standard:gb-t-33333-2024', [n['id'] for n in payload['nodes']])

    def test_analysis_cannot_claim_normative_reference_or_replacement(self):
        _, payload = fixture('# GB/T 12345-2024\n本文件代替 GB/T 12345-2020。\n## 2 规范性引用文件\nGB/T 22222-2020', role='analysis')
        self.assertFalse(any(e['predicate'] in {'supersedes', 'normativelyReferences'} for e in payload['edges']))

    def test_reader_page_cannot_overwrite_original_clause_identity(self):
        _, payload = fixture('# GB/T 12345-2024\n## 1 导读中的编号', role='source-reader')
        self.assertFalse(any(n['type'] == 'Clause' for n in payload['nodes']))

    def test_replacement_supports_multiple_numbers_and_stops_before_comparison(self):
        _, payload = fixture('# GB/T 12345-2024\n本文件代替 GB/T 11111—2005《甲》、GB/Z 22222—2007《乙》，与 GB/T 33333—2010 相比，改变如下。')
        old = [e['object'] for e in payload['edges'] if e['predicate'] == 'supersedes']
        self.assertCountEqual(old, ['standard:gb-t-11111-2005', 'standard:gb-z-22222-2007'])

    def test_newer_year_and_version_history_do_not_imply_replacement(self):
        _, payload = fixture('# GB/T 12345-2024\n参见 GB/T 12345-2020。\n本文件所代替文件的历次版本发布情况为：\n- GB/T 12345-2010')
        self.assertFalse(any(e['predicate'] == 'supersedes' for e in payload['edges']))

    def test_effective_date_replacement_statement_is_recognized(self):
        self.assertIsNotNone(REPLACEMENT.match('本标准从实施之日起，代替 GB 11643-1989。'))

    def test_appendix_template_does_not_overwrite_main_clause(self):
        _, payload = fixture('# GB/T 12345-2024\n## 1 范围\n正文\n## 附录 F（资料性）报告模板\n### 1 项目概述\n模板示例')
        clauses = [n for n in payload['nodes'] if n['type'] == 'Clause']
        self.assertEqual({n['number'] for n in clauses}, {'1', 'F/template/1'})
        self.assertEqual(next(n for n in clauses if n['sectionKind'] == 'template')['preview'], '模板示例')

    def test_duplicate_main_clauses_fail(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate clause'):
            fixture('# GB/T 12345-2024\n## 1 范围\n## 1 第二个范围')

    def test_source_ids_survive_moves_and_generic_headings_do_not_collide(self):
        entry = {'role': 'source-text', 'path': '甲/原文/_商用密码管理条例原文.md', 'title': '版本说明'}
        self.assertEqual(document_id(entry), document_id({**entry, 'path': '乙/原文/_商用密码管理条例原文.md'}))
        self.assertNotEqual(document_id(entry), document_id({**entry, 'path': '甲/原文/_商用密码应用安全性评估管理办法原文.md'}))
        self.assertEqual(document_id({'role': 'analysis', 'path': '移动前.md', 'slug': '/stable'}),
                         document_id({'role': 'analysis', 'path': '移动后.md', 'slug': '/stable'}))

    def test_evidence_is_literal_and_line_locatable(self):
        builder, payload = fixture('# GB/T 12345-2024\n## 2 规范性引用文件\n- GB/T 22222-2020')
        validate_payload(payload, builder.lines)
        invalid = copy.deepcopy(payload)
        invalid['evidence'][0]['quote'] = '不存在的依据'
        with self.assertRaisesRegex(ValueError, 'Untraceable evidence'):
            validate_payload(invalid, builder.lines)

    def test_dangling_relationship_and_missing_evidence_fail(self):
        builder, payload = fixture('# GB/T 12345-2024\n正文')
        for key, value, message in [('object', 'missing', 'Dangling'), ('evidence', [], 'Invalid assertion')]:
            invalid = copy.deepcopy(payload)
            invalid['edges'][0][key] = value
            with self.assertRaisesRegex(ValueError, message):
                validate_payload(invalid, builder.lines)

    def test_rdf_serialization_round_trip_and_shacl(self):
        builder, payload = fixture('# GB/T 12345-2024\n## 1 范围\n测试\n## 2 规范性引用文件\n- GB/T 22222-2020')
        validate_payload(payload, builder.lines)
        graph = to_rdf(payload)
        validate_graph(graph)
        from rdflib.compare import isomorphic
        from rdflib import Graph
        self.assertTrue(isomorphic(graph, Graph().parse(data=graph.serialize(format='turtle'), format='turtle')))

    def test_shacl_rejects_missing_version_parent_and_evidence(self):
        _, payload = fixture('# GB/T 12345-2024\n## 1 范围')
        graph = to_rdf(payload)
        graph.remove((None, C.hasVersion, None))
        with self.assertRaisesRegex(ValueError, 'Validation Report'):
            validate_graph(graph)

    def test_shacl_rejects_replacement_cycles(self):
        _, payload = fixture('# GB/T 12345-2024\n本文件代替 GB/T 12345-2020。')
        graph = to_rdf(payload)
        graph.add((uri('standard:gb-t-12345-2020'), C.supersedes, uri('standard:gb-t-12345-2024')))
        with self.assertRaisesRegex(ValueError, '替代关系不能形成环'):
            validate_graph(graph)

    def test_shacl_rejects_unrecognized_predicate(self):
        _, payload = fixture('# GB/T 12345-2024')
        graph = to_rdf(payload)
        assertion = next(graph.subjects(RDF.type, C.Assertion))
        graph.set((assertion, RDF.predicate, C.unknown))
        with self.assertRaisesRegex(ValueError, 'Validation Report'):
            validate_graph(graph)


class ExportedGraphQueryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parent.parent
        cls.graph = Graph().parse(cls.root / 'static/data/compliance/graph.ttl')

    def query(self, name):
        return list(self.graph.query((self.root / f'config/compliance-ontology/{name}.rq').read_text()))

    def test_normative_query_returns_dated_versions_and_literal_evidence(self):
        rows = self.query('references')
        targets = {str(row.reference) for row in rows}
        self.assertIn(str(uri('standard:gb-t-22240-2020')), targets)
        self.assertIn(str(uri('standard:gb-t-25069-2022')), targets)
        self.assertTrue(all(int(row.line) > 0 and str(row.quote) for row in rows))

    def test_impact_query_returns_actual_old_edition_citations(self):
        rows = self.query('impact')
        self.assertTrue(any(str(row.old) == str(uri('standard:gb-z-20986-2007'))
                            and str(row.new) == str(uri('standard:gb-t-20986-2023')) for row in rows))
        self.assertTrue(all(str(row.quote) for row in rows))

    def test_missing_query_distinguishes_guides_from_originals(self):
        found = {str(row.standard) for row in self.query('missing')}
        self.assertIn(str(uri('standard:gb-t-22081-2016')), found)
        self.assertNotIn(str(uri('standard:gb-t-35273-2020')), found)

    def test_real_standard_regulation_law_chain_is_explicit_and_versioned(self):
        standard, regulation, law = map(uri, ['standard:gb-t-39204-2022', 'document:cii-security-protection', 'document:cybersecurity-law'])
        self.assertIn((standard, C.implements, regulation), self.graph)
        self.assertIn((standard, C.implements, law), self.graph)
        self.assertIn((regulation, C.enactedUnder, law), self.graph)
        self.assertNotIn((law, C.implements, standard), self.graph)
        self.assertNotIn((uri('standard:gb-t-35273-2020'), C.implements, uri('document:personal-info-protection-law')), self.graph)


if __name__ == '__main__':
    unittest.main()
