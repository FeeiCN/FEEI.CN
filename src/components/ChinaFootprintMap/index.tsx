import {useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import styles from './styles.module.css';

type ProvinceVisit = {
  name: string;
  shortName: string;
  value: number;
  trips: Array<{
    year: number;
    places: string[];
  }>;
};

type CountryVisit = {
  name: string;
  label: string;
  displayName: string;
  value: number;
  coord?: [number, number];
};

type YearFootprintRow = {
  year: number;
  footprints: string[];
};

const visitedProvinces: ProvinceVisit[] = [
  {name: '上海市', shortName: '上海', value: 7, trips: [{year: 2013, places: ['上海']}, {year: 2017, places: ['上海']}, {year: 2018, places: ['上海']}, {year: 2019, places: ['上海']}, {year: 2021, places: ['上海']}, {year: 2023, places: ['上海']}, {year: 2024, places: ['上海']}]},
  {name: '浙江省', shortName: '浙江', value: 10, trips: [{year: 2014, places: ['安吉']}, {year: 2015, places: ['安吉']}, {year: 2016, places: ['千岛湖', '舟山东极岛']}, {year: 2017, places: ['千岛湖', '舟山']}, {year: 2020, places: ['千岛湖']}, {year: 2021, places: ['千岛湖', '嘉兴']}, {year: 2022, places: ['千岛湖', '大明山', '临安']}, {year: 2023, places: ['千岛湖']}, {year: 2024, places: ['莫干山']}, {year: 2025, places: ['温州', '衢州', '开化']}]},
  {name: '安徽省', shortName: '安徽', value: 4, trips: [{year: 2015, places: ['黄山']}, {year: 2016, places: ['黄山']}, {year: 2022, places: ['黟县']}, {year: 2023, places: ['黄山']}]},
  {name: '江苏省', shortName: '江苏', value: 2, trips: [{year: 2016, places: ['苏州']}, {year: 2024, places: ['苏州', '南京', '南浔']}]},
  {name: '江西省', shortName: '江西', value: 2, trips: [{year: 2021, places: ['九江']}, {year: 2022, places: ['庐山']}]},
  {name: '海南省', shortName: '海南', value: 3, trips: [{year: 2014, places: ['三亚']}, {year: 2020, places: ['三亚']}, {year: 2022, places: ['万宁', '三亚', '神州半岛', '陵水']}]},
  {name: '广东省', shortName: '广东', value: 5, trips: [{year: 2018, places: ['深圳']}, {year: 2022, places: ['珠海', '阳江']}, {year: 2023, places: ['深圳']}, {year: 2024, places: ['深圳']}, {year: 2024, places: ['广州']}]},
  {name: '香港特别行政区', shortName: '中国香港', value: 1, trips: [{year: 2019, places: ['香港']}]},
  {name: '台湾省', shortName: '中国台湾', value: 1, trips: [{year: 2016, places: ['台湾']}]},
  {name: '福建省', shortName: '福建', value: 3, trips: [{year: 2018, places: ['泉州', '石狮']}, {year: 2019, places: ['宁德']}, {year: 2024, places: ['石狮', '晋江', '厦门']}]},
  {name: '山东省', shortName: '山东', value: 1, trips: [{year: 2024, places: ['青岛']}]},
  {name: '广西壮族自治区', shortName: '广西', value: 2, trips: [{year: 2025, places: ['南宁', '钦州', '崇左', '百色']}, {year: 2025, places: ['北海']}]},
  {name: '贵州省', shortName: '贵州', value: 2, trips: [{year: 2024, places: ['贵阳', '黔西南', '黄果树瀑布', '万峰林']}, {year: 2025, places: ['贵阳']}]},
  {name: '云南省', shortName: '云南', value: 2, trips: [{year: 2024, places: ['西双版纳', '大理', '泸沽湖']}, {year: 2025, places: ['文山', '昆明']}]},
  {name: '四川省', shortName: '四川', value: 3, trips: [{year: 2019, places: ['成都']}, {year: 2023, places: ['阿坝州', '阿克里', '甘孜', '理塘']}, {year: 2025, places: ['绵阳', '成都']}]},
  {name: '西藏自治区', shortName: '西藏', value: 1, trips: [{year: 2025, places: ['拉萨', '山南', '林芝']}]},
  {name: '新疆维吾尔自治区', shortName: '新疆', value: 2, trips: [{year: 2019, places: ['乌鲁木齐', '阿勒泰', '喀纳斯', '吐鲁番']}, {year: 2023, places: ['喀什', '阿克苏', '塔县', '和田']}]},
  {name: '青海省', shortName: '青海', value: 2, trips: [{year: 2018, places: ['青海']}, {year: 2024, places: ['青海湖', '海南']}]},
  {name: '甘肃省', shortName: '甘肃', value: 1, trips: [{year: 2018, places: ['酒泉', '敦煌', '张掖']}]},
  {name: '内蒙古自治区', shortName: '内蒙古', value: 1, trips: [{year: 2024, places: ['额尔古纳', '室韦', '根河', '满洲里']}]},
  {name: '辽宁省', shortName: '辽宁', value: 1, trips: [{year: 2025, places: ['沈阳', '大连']}]},
  {name: '湖北省', shortName: '湖北', value: 5, trips: [{year: 2015, places: ['武汉']}, {year: 2016, places: ['武汉']}, {year: 2018, places: ['蕲春']}, {year: 2020, places: ['武汉', '蕲春']}, {year: 2021, places: ['蕲春']}]},
  {name: '北京市', shortName: '北京', value: 5, trips: [{year: 2014, places: ['北京']}, {year: 2015, places: ['北京']}, {year: 2017, places: ['北京']}, {year: 2019, places: ['北京']}, {year: 2021, places: ['北京']}]},
  {name: '黑龙江省', shortName: '黑龙江', value: 2, trips: [{year: 2019, places: ['牡丹江']}, {year: 2021, places: ['牡丹江市（雪乡）', '哈尔滨']}]},
  {name: '陕西省', shortName: '陕西', value: 2, trips: [{year: 2017, places: ['西安']}, {year: 2018, places: ['西安']}]},
  {name: '重庆市', shortName: '重庆', value: 1, trips: [{year: 2023, places: ['重庆']}]},
  {name: '宁夏回族自治区', shortName: '宁夏', value: 1, trips: [{year: 2020, places: ['中卫', '银川']}]},
  {name: '河南省', shortName: '河南', value: 2, trips: [{year: 2017, places: ['郑州']}, {year: 2018, places: ['郑州']}]},
];

const visitedCountries: CountryVisit[] = [
  {name: 'China', label: '中国', displayName: '中国(China)', value: 26},
  {name: 'Hong Kong', label: '中国香港', displayName: '中国香港(Hong Kong)', value: 1, coord: [114.1694, 22.3193]},
  {name: 'Taiwan', label: '中国台湾', displayName: '中国台湾(Taiwan)', value: 1},
  {name: 'Japan', label: '日本', displayName: '日本(Japan)', value: 2},
  {name: 'Vietnam', label: '越南', displayName: '越南(Vietnam)', value: 1},
  {name: 'Singapore', label: '新加坡', displayName: '新加坡(Singapore)', value: 1, coord: [103.8198, 1.3521]},
  {name: 'Malaysia', label: '马来西亚', displayName: '马来西亚(Malaysia)', value: 1},
  {name: 'Thailand', label: '泰国', displayName: '泰国(Thailand)', value: 4},
  {name: 'South Korea', label: '韩国', displayName: '韩国(South Korea)', value: 1},
];

const WORLD_NAME_ZH: Record<string, string> = {
  Afghanistan: '阿富汗',
  Albania: '阿尔巴尼亚',
  Algeria: '阿尔及利亚',
  Angola: '安哥拉',
  Antarctica: '南极洲',
  Argentina: '阿根廷',
  Armenia: '亚美尼亚',
  Australia: '澳大利亚',
  Austria: '奥地利',
  Azerbaijan: '阿塞拜疆',
  Bangladesh: '孟加拉国',
  Belarus: '白俄罗斯',
  Belgium: '比利时',
  Belize: '伯利兹',
  Benin: '贝宁',
  Bhutan: '不丹',
  Bolivia: '玻利维亚',
  'Bosnia and Herzegovina': '波斯尼亚和黑塞哥维那',
  Botswana: '博茨瓦纳',
  Brazil: '巴西',
  Brunei: '文莱',
  Bulgaria: '保加利亚',
  'Burkina Faso': '布基纳法索',
  Burundi: '布隆迪',
  Cambodia: '柬埔寨',
  Cameroon: '喀麦隆',
  Canada: '加拿大',
  'Central African Republic': '中非共和国',
  Chad: '乍得',
  Chile: '智利',
  China: '中国',
  Colombia: '哥伦比亚',
  'Costa Rica': '哥斯达黎加',
  Croatia: '克罗地亚',
  Cuba: '古巴',
  Cyprus: '塞浦路斯',
  'Czech Republic': '捷克',
  'Democratic Republic of the Congo': '刚果民主共和国',
  Denmark: '丹麦',
  Djibouti: '吉布提',
  'Dominican Republic': '多米尼加共和国',
  'East Timor': '东帝汶',
  Ecuador: '厄瓜多尔',
  Egypt: '埃及',
  'El Salvador': '萨尔瓦多',
  England: '英格兰',
  'Equatorial Guinea': '赤道几内亚',
  Eritrea: '厄立特里亚',
  Estonia: '爱沙尼亚',
  Ethiopia: '埃塞俄比亚',
  'Falkland Islands': '福克兰群岛',
  Fiji: '斐济',
  Finland: '芬兰',
  France: '法国',
  'French Southern and Antarctic Lands': '法属南部和南极领地',
  Gabon: '加蓬',
  Gambia: '冈比亚',
  Georgia: '格鲁吉亚',
  Germany: '德国',
  Ghana: '加纳',
  Greece: '希腊',
  Greenland: '格陵兰',
  Guatemala: '危地马拉',
  Guinea: '几内亚',
  'Guinea Bissau': '几内亚比绍',
  Guyana: '圭亚那',
  Haiti: '海地',
  Honduras: '洪都拉斯',
  Hungary: '匈牙利',
  Iceland: '冰岛',
  India: '印度',
  Indonesia: '印度尼西亚',
  Iran: '伊朗',
  Iraq: '伊拉克',
  Ireland: '爱尔兰',
  Israel: '以色列',
  Italy: '意大利',
  'Ivory Coast': '科特迪瓦',
  Jamaica: '牙买加',
  Japan: '日本',
  Jordan: '约旦',
  Kazakhstan: '哈萨克斯坦',
  Kenya: '肯尼亚',
  Kosovo: '科索沃',
  Kuwait: '科威特',
  Kyrgyzstan: '吉尔吉斯斯坦',
  Laos: '老挝',
  Latvia: '拉脱维亚',
  Lebanon: '黎巴嫩',
  Lesotho: '莱索托',
  Liberia: '利比里亚',
  Libya: '利比亚',
  Lithuania: '立陶宛',
  Luxembourg: '卢森堡',
  Macedonia: '北马其顿',
  Madagascar: '马达加斯加',
  Malawi: '马拉维',
  Malaysia: '马来西亚',
  Mali: '马里',
  Mauritania: '毛里塔尼亚',
  Mexico: '墨西哥',
  Moldova: '摩尔多瓦',
  Mongolia: '蒙古',
  Montenegro: '黑山',
  Morocco: '摩洛哥',
  Mozambique: '莫桑比克',
  Myanmar: '缅甸',
  Namibia: '纳米比亚',
  Nepal: '尼泊尔',
  Netherlands: '荷兰',
  'New Caledonia': '新喀里多尼亚',
  'New Zealand': '新西兰',
  Nicaragua: '尼加拉瓜',
  Niger: '尼日尔',
  Nigeria: '尼日利亚',
  'North Korea': '朝鲜',
  'Northern Cyprus': '北塞浦路斯',
  Norway: '挪威',
  Oman: '阿曼',
  Pakistan: '巴基斯坦',
  Panama: '巴拿马',
  'Papua New Guinea': '巴布亚新几内亚',
  Paraguay: '巴拉圭',
  Peru: '秘鲁',
  Philippines: '菲律宾',
  Poland: '波兰',
  Portugal: '葡萄牙',
  'Puerto Rico': '波多黎各',
  Qatar: '卡塔尔',
  'Republic of Serbia': '塞尔维亚',
  'Republic of the Congo': '刚果共和国',
  Romania: '罗马尼亚',
  Russia: '俄罗斯',
  Rwanda: '卢旺达',
  'Saudi Arabia': '沙特阿拉伯',
  Senegal: '塞内加尔',
  'Sierra Leone': '塞拉利昂',
  Slovakia: '斯洛伐克',
  Slovenia: '斯洛文尼亚',
  'Solomon Islands': '所罗门群岛',
  Somalia: '索马里',
  Somaliland: '索马里兰',
  'South Africa': '南非',
  'South Korea': '韩国',
  'South Sudan': '南苏丹',
  Spain: '西班牙',
  'Sri Lanka': '斯里兰卡',
  Sudan: '苏丹',
  Suriname: '苏里南',
  Swaziland: '斯威士兰',
  Sweden: '瑞典',
  Switzerland: '瑞士',
  Syria: '叙利亚',
  Taiwan: '中国台湾',
  'Hong Kong': '中国香港',
  Macao: '中国澳门',
  Tajikistan: '塔吉克斯坦',
  Thailand: '泰国',
  'The Bahamas': '巴哈马',
  Togo: '多哥',
  'Trinidad and Tobago': '特立尼达和多巴哥',
  Tunisia: '突尼斯',
  Turkey: '土耳其',
  Turkmenistan: '土库曼斯坦',
  USA: '美国',
  Uganda: '乌干达',
  Ukraine: '乌克兰',
  'United Arab Emirates': '阿拉伯联合酋长国',
  'United Republic of Tanzania': '坦桑尼亚',
  Uruguay: '乌拉圭',
  Uzbekistan: '乌兹别克斯坦',
  Vanuatu: '瓦努阿图',
  Venezuela: '委内瑞拉',
  Vietnam: '越南',
  'West Bank': '约旦河西岸',
  'Western Sahara': '西撒哈拉',
  Yemen: '也门',
  Zambia: '赞比亚',
  Zimbabwe: '津巴布韦',
};

const worldYearRows: YearFootprintRow[] = [
  {
    year: 2025,
    footprints: [
      '中国(China) · 西藏：拉萨、山南、林芝',
      '中国(China) · 四川：绵阳、成都',
      '中国(China) · 广西：南宁、钦州、崇左、百色、北海',
      '中国(China) · 云南：文山、昆明',
      '中国(China) · 贵州：贵阳',
      '中国(China) · 辽宁：沈阳、大连',
      '中国(China) · 浙江：温州、衢州、开化',
    ],
  },
  {
    year: 2024,
    footprints: [
      '泰国(Thailand)：斯米兰',
      '中国(China) · 内蒙古：额尔古纳、室韦、根河、满洲里',
      '中国(China) · 青海：青海湖、海南',
      '中国(China) · 贵州：贵阳、黔西南、黄果树瀑布、万峰林',
      '中国(China) · 云南：西双版纳、大理、泸沽湖',
      '中国(China) · 山东：青岛',
      '中国(China) · 广东：深圳、广州',
      '中国(China) · 福建：石狮、晋江、厦门',
      '中国(China) · 江苏：苏州、南京、南浔',
      '中国(China) · 上海：上海',
      '中国(China) · 浙江：莫干山',
    ],
  },
  {
    year: 2023,
    footprints: [
      '韩国(South Korea)：济州岛',
      '中国(China) · 新疆：喀什、阿克苏、塔县、和田',
      '中国(China) · 四川：阿坝州、阿克里、甘孜、理塘',
      '中国(China) · 安徽：黄山',
      '中国(China) · 重庆：重庆',
      '中国(China) · 浙江：千岛湖',
      '中国(China) · 上海：上海',
      '中国(China) · 广东：深圳',
    ],
  },
  {
    year: 2022,
    footprints: [
      '中国(China) · 海南：万宁、三亚、神州半岛、陵水',
      '中国(China) · 广东：珠海、阳江',
      '中国(China) · 安徽：黟县',
      '中国(China) · 江西：庐山',
      '中国(China) · 浙江：临安、千岛湖、大明山',
    ],
  },
  {
    year: 2021,
    footprints: [
      '中国(China) · 上海：上海',
      '中国(China) · 浙江：千岛湖、嘉兴',
      '中国(China) · 湖北：蕲春',
      '中国(China) · 江西：九江',
      '中国(China) · 北京：北京',
      '中国(China) · 黑龙江：牡丹江市（雪乡）、哈尔滨',
    ],
  },
  {
    year: 2020,
    footprints: [
      '泰国(Thailand)：清迈、清莱',
      '中国(China) · 浙江：千岛湖',
      '中国(China) · 海南：三亚',
      '中国(China) · 湖北：武汉、蕲春',
      '中国(China) · 宁夏：中卫、银川',
    ],
  },
  {
    year: 2019,
    footprints: [
      '泰国(Thailand)：曼谷',
      '马来西亚(Malaysia)：长滩岛',
      '中国香港(Hong Kong)：香港',
      '中国(China) · 新疆：乌鲁木齐、阿勒泰、喀纳斯、吐鲁番',
      '中国(China) · 上海：上海',
      '中国(China) · 四川：成都',
      '中国(China) · 福建：宁德',
      '中国(China) · 黑龙江：牡丹江',
      '中国(China) · 北京：北京',
    ],
  },
  {
    year: 2018,
    footprints: [
      '泰国(Thailand)：普吉岛',
      '中国(China) · 青海：青海',
      '中国(China) · 甘肃：酒泉、敦煌、张掖',
      '中国(China) · 上海：上海',
      '中国(China) · 广东：深圳',
      '中国(China) · 陕西：西安',
      '中国(China) · 福建：泉州、石狮',
      '中国(China) · 湖北：蕲春',
      '中国(China) · 河南：郑州',
    ],
  },
  {
    year: 2017,
    footprints: [
      '日本(Japan)：冲绳岛',
      '中国(China) · 上海：上海',
      '中国(China) · 浙江：千岛湖、舟山',
      '中国(China) · 陕西：西安',
      '中国(China) · 北京：北京',
      '中国(China) · 河南：郑州',
    ],
  },
  {
    year: 2016,
    footprints: [
      '日本(Japan)：大阪',
      '越南(Vietnam)：岘港',
      '中国台湾(Taiwan)：台湾',
      '中国(China) · 江苏：苏州',
      '中国(China) · 浙江：千岛湖、舟山东极岛',
      '中国(China) · 安徽：黄山',
      '中国(China) · 湖北：武汉',
    ],
  },
  {
    year: 2015,
    footprints: [
      '新加坡(Singapore)：新加坡',
      '中国(China) · 安徽：黄山',
      '中国(China) · 浙江：安吉',
      '中国(China) · 湖北：武汉',
      '中国(China) · 北京：北京',
    ],
  },
  {
    year: 2014,
    footprints: [
      '中国(China) · 北京：北京',
      '中国(China) · 浙江：安吉',
      '中国(China) · 海南：三亚',
    ],
  },
  {
    year: 2013,
    footprints: [
      '中国(China) · 上海：上海',
    ],
  },
];

const CHINA_MAP_NAME = 'china-footprint';
const WORLD_MAP_NAME = 'world-footprint';

type GeoJson = Parameters<typeof echarts.registerMap>[1];

function formatList(items: Array<string | number>) {
  return items.join('、');
}

function formatTrips(trips: ProvinceVisit['trips']) {
  return trips
    .map((trip) => `${trip.year}：${formatList(trip.places)}`)
    .join('；');
}

function splitFootprint(footprint: string) {
  const [province, places] = footprint.split('：');
  return {province, places};
}

function buildDisplayFootprints(footprints: string[], view: 'world' | 'china') {
  let hasShownChina = false;
  const chinaPrefix = '中国(China) · ';
  const displayFootprints: Array<{
    province: string;
    places: string;
    key: string;
    indented: boolean;
  }> = [];

  footprints.forEach((footprint) => {
    const {province, places} = splitFootprint(footprint);

    if (view === 'world' && province.startsWith(chinaPrefix)) {
      if (!hasShownChina) {
        displayFootprints.push({
          province: '中国(China)',
          places: '',
          key: `${footprint}-china`,
          indented: false,
        });
        hasShownChina = true;
      }

      displayFootprints.push({
        province: province.replace(chinaPrefix, ''),
        places,
        key: footprint,
        indented: true,
      });
      return;
    }

    displayFootprints.push({province, places, key: footprint, indented: false});
  });

  return displayFootprints;
}

function getWorldDisplayName(name: string) {
  const zhName = WORLD_NAME_ZH[name];
  return zhName ? `${zhName}(${name})` : name;
}

function buildChinaYearRows(data: ProvinceVisit[]): YearFootprintRow[] {
  const yearMap = new Map<number, Map<string, {shortName: string; places: string[]}>>();

  data.forEach((province) => {
    province.trips.forEach((trip) => {
      if (!yearMap.has(trip.year)) {
        yearMap.set(trip.year, new Map());
      }

      const provinceMap = yearMap.get(trip.year);
      const current = provinceMap?.get(province.name) ?? {
        shortName: province.shortName,
        places: [],
      };

      current.places.push(...trip.places);
      provinceMap?.set(province.name, current);
    });
  });

  return [...yearMap.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, provinceMap]) => ({
      year,
      footprints: [...provinceMap.values()].map(
        (item) => `${item.shortName}：${formatList([...new Set(item.places)])}`,
      ),
    }));
}

function buildWorldOption(isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#cbd5e1' : '#475569';
  const borderColor = isDark ? '#334155' : '#cbd5e1';
  const countryMap = new Map(visitedCountries.map((item) => [item.name, item]));
  const pointCountries = visitedCountries.filter((item) => item.coord);

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      borderWidth: 0,
      formatter: (params: {name: string}) => {
        const item = countryMap.get(params.name);
        if (!item) {
          return `${getWorldDisplayName(params.name)}<br/>尚未留下足迹`;
        }

        return item.name === 'China'
          ? `${item.displayName}<br/>点击查看中国省级足迹`
          : `${item.displayName}<br/>已留下足迹`;
      },
    },
    series: [
      {
        name: '世界足迹',
        type: 'map',
        map: WORLD_MAP_NAME,
        roam: false,
        zoom: isMobile ? 1.05 : 1.15,
        label: {
          show: false,
          color: labelColor,
          fontSize: 10,
          formatter: (params: {name: string}) => getWorldDisplayName(params.name),
        },
        emphasis: {
          label: {
            show: true,
            color: isDark ? '#f8fafc' : '#0f172a',
            formatter: (params: {name: string}) => getWorldDisplayName(params.name),
          },
          itemStyle: {
            areaColor: '#f97316',
            borderColor: '#fb923c',
          },
        },
        select: {
          disabled: true,
        },
        itemStyle: {
          areaColor: '#ffffff',
          borderColor,
          borderWidth: 0.5,
        },
        markPoint: {
          symbol: 'circle',
          symbolSize: 8,
          tooltip: {
            formatter: (params: {name: string}) => {
              const item = countryMap.get(params.name);
              return `${item?.displayName ?? getWorldDisplayName(params.name)}<br/>已留下足迹`;
            },
          },
          label: {show: false},
          itemStyle: {
            color: isDark ? '#2dd4bf' : '#0d9488',
            borderColor: '#ffffff',
            borderWidth: 1.5,
          },
          data: pointCountries.map((item) => ({
            name: item.name,
            coord: item.coord,
          })),
        },
        data: visitedCountries.map((item) => ({
          ...item,
          itemStyle: {
            areaColor: item.name === 'China'
              ? (isDark ? '#f97316' : '#fb923c')
              : (isDark ? 'rgba(45, 212, 191, 0.72)' : 'rgba(13, 148, 136, 0.68)'),
            borderColor,
            borderWidth: item.name === 'China' ? 1.2 : 0.7,
          },
        })),
      },
    ],
  };
}

function buildChinaOption(data: ProvinceVisit[], isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#cbd5e1' : '#475569';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const borderColor = isDark ? '#334155' : '#cbd5e1';
  const unvisitedAreaColor = '#ffffff';
  const unvisitedBorderColor = isDark ? '#64748b' : '#cbd5e1';
  const visitMap = new Map(data.map((item) => [item.name, item]));
  const maxValue = Math.max(...data.map((item) => item.value));

  const visitedColor = (value: number) => {
    const opacity = 0.58 + (value / maxValue) * 0.22;
    return isDark
      ? `rgba(45, 212, 191, ${opacity})`
      : `rgba(13, 148, 136, ${opacity})`;
  };

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      borderWidth: 0,
      formatter: (params: {name: string}) => {
        const item = visitMap.get(params.name);
        if (!item) {
          return `${params.name}<br/>尚未留下足迹`;
        }

        return [
          `${item.shortName}：${item.value} 次`,
          formatTrips(item.trips),
        ].join('<br/>');
      },
    },
    visualMap: {
      show: false,
    },
    series: [
      {
        name: '中国足迹',
        type: 'map',
        map: CHINA_MAP_NAME,
        roam: false,
        zoom: isMobile ? 1.05 : 1.15,
        scaleLimit: {min: 0.9, max: 5},
        label: {
          show: !isMobile,
          color: labelColor,
          fontSize: 10,
        },
        emphasis: {
          label: {show: true, color: isDark ? '#f8fafc' : '#0f172a'},
          itemStyle: {
            areaColor: '#f97316',
            borderColor: '#fb923c',
          },
        },
        select: {
          disabled: true,
        },
        itemStyle: {
          areaColor: unvisitedAreaColor,
          borderColor: unvisitedBorderColor,
          borderWidth: 0.7,
        },
        data: data.map((item) => ({
          ...item,
          itemStyle: {
            areaColor: visitedColor(item.value),
            borderColor: isDark ? '#5eead4' : '#0f766e',
            borderWidth: 1.3,
          },
        })),
      },
    ],
  };
}

function ChinaFootprintMapInner() {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'world' | 'china'>('world');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/maps/china.json').then((response) => response.json()),
      fetch('/maps/world.json').then((response) => response.json()),
    ])
      .then(([chinaGeoJson, worldGeoJson]: [GeoJson, GeoJson]) => {
        if (cancelled) return;
        echarts.registerMap(CHINA_MAP_NAME, chinaGeoJson);
        echarts.registerMap(WORLD_MAP_NAME, worldGeoJson);
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const option = useMemo(
    () => view === 'world'
      ? buildWorldOption(isDark, isMobile)
      : buildChinaOption(visitedProvinces, isDark, isMobile),
    [isDark, isMobile, view],
  );

  const visitedCount = visitedProvinces.length;
  const placeCount = visitedProvinces.reduce(
    (sum, item) => sum + item.trips.reduce((tripSum, trip) => tripSum + trip.places.length, 0),
    0,
  );
  const tableData = view === 'world' ? worldYearRows : buildChinaYearRows(visitedProvinces);

  return (
    <div className={styles.wrap}>
      {view === 'china' ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.button} onClick={() => setView('world')}>
            返回世界地图
          </button>
        </div>
      ) : null}
      {view === 'china' ? (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statValue}>{visitedCount}/34</div>
            <div className={styles.statLabel}>省级行政区留下足迹</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{placeCount}</div>
            <div className={styles.statLabel}>城市与目的地记录</div>
          </div>
        </div>
      ) : null}
      {ready ? (
        <ReactECharts
          className={styles.chart}
          option={option}
          theme={isDark ? 'dark' : undefined}
          opts={{renderer: 'svg'}}
          onEvents={{
            click: (params: {name?: string}) => {
              if (view === 'world' && params.name === 'China') {
                setView('china');
              }
            },
          }}
        />
      ) : (
        <div className={styles.loading}>地图加载中</div>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>年份</th>
              <th>足迹</th>
            </tr>
          </thead>
          <tbody>
            {tableData.map((item) => (
              <tr key={item.year}>
                <td className={styles.yearCell}>{item.year}</td>
                <td>
                  <div className={styles.footprintList}>
                    {buildDisplayFootprints(item.footprints, view).map(({province, places, key, indented}) => (
                      <div
                        key={key}
                        className={indented
                          ? `${styles.footprintItem} ${styles.footprintItemIndented}`
                          : styles.footprintItem}
                      >
                        <span className={styles.provinceName}>{province}</span>
                        {places}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ChinaFootprintMap() {
  return (
    <BrowserOnly fallback={<div className={styles.loading} />}>
      {() => <ChinaFootprintMapInner />}
    </BrowserOnly>
  );
}
