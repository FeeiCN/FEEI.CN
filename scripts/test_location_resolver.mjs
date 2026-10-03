import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';

const siteDir = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);
const resolver = jiti(path.join(siteDir, 'src/utils/locationResolver.ts'));

const cases = [
  ['杭州', 'Hangzhou', 'CN'],
  ['九江', 'Jiujiang', 'CN'],
  ['小樽', 'Otaru', 'JP'],
];

for (const [location, expectedName, expectedCountry] of cases) {
  test(`${location} prefers the matching GeoNames entity`, () => {
    const result = resolver.chooseGeoNamesResult(location, location, [
      {name: 'Other', countryCode: 'US', featureCode: 'PPL', population: 5000000},
      {name: expectedName, countryCode: expectedCountry, featureCode: 'PPL', population: 100000,
       alternateNames: [{name: location}]},
    ]);
    assert.equal(result.name, expectedName);
    assert.equal(result.countryCode, expectedCountry);
  });
}

test('蕲春 resolves by alternate name instead of a larger unrelated city', () => {
  const result = resolver.chooseGeoNamesResult('蕲春', 'Qichun', [
    {name: 'Qichun', countryCode: 'XX', featureCode: 'PPL', population: 9000000},
    {name: 'Caohe', countryCode: 'CN', adminName1: 'Hubei', adminName2: 'Huanggang Shi',
     featureCode: 'PPLA3', population: 67370, alternateNames: [{name: 'Qichun'}, {name: '蕲春'}]},
  ]);
  assert.equal(result.name, 'Caohe');
  assert.equal(result.countryCode, 'CN');
});

test('千岛湖 keeps its explicit CN disambiguation as a soft preference', () => {
  const result = resolver.chooseGeoNamesResult('千岛湖', 'Qiandaohu', [
    {name: 'Qiandaohu', countryCode: 'XX', featureCode: 'PPL', population: 1000000},
    {name: 'Qiandaohu', countryCode: 'CN', featureCode: 'PPL', population: 30000},
  ]);
  assert.equal(result.countryCode, 'CN');
});

for (const [location, expectedCountry] of [['札幌', 'JP'], ['函馆', 'JP']]) {
  test(`${location} alias country is preferred without making language imply country`, () => {
    const result = resolver.chooseGeoNamesResult(location, resolver.geocodingNames(location)[0], [
      {name: resolver.geocodingNames(location)[0], countryCode: 'US', featureCode: 'PPL', population: 2000000},
      {name: resolver.geocodingNames(location)[0], countryCode: expectedCountry, featureCode: 'PPL', population: 500000},
    ]);
    assert.equal(result.countryCode, expectedCountry);
  });
}

test('normalization removes administrative suffixes without adding any', () => {
  assert.equal(resolver.normalizePlaceName('杭州市'), resolver.normalizePlaceName('杭州'));
  assert.equal(resolver.normalizePlaceName('蕲春县'), resolver.normalizePlaceName('蕲春'));
});
