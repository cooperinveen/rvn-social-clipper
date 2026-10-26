// Suggest a shotlist title ("US PRESIDENT", "BRITISH PRIME MINISTER", "ANTHROPIC CEO") from a
// poster's bio. This is deliberately conservative: it answers only when the bio clearly says
// "<role> of <country>" or "<organisation> CEO"; otherwise it returns null and the producer
// types the title. A wrong title in a shotlist is an editorial error, so a blank is better
// than a guess. The producer always sees the bio next to the suggestion and can change it.

// Country (as it appears in a bio) -> the adjective Reuters puts before a job title.
const DEMONYMS = {
  'the united states': 'US', 'united states': 'US', 'the us': 'US', 'the u.s.': 'US', 'america': 'US', 'the usa': 'US', 'usa': 'US',
  'the united kingdom': 'BRITISH', 'united kingdom': 'BRITISH', 'the uk': 'BRITISH', 'uk': 'BRITISH', 'britain': 'BRITISH', 'great britain': 'BRITISH',
  'ukraine': 'UKRAINIAN', 'russia': 'RUSSIAN', 'china': 'CHINESE', 'india': 'INDIAN', 'japan': 'JAPANESE', 'germany': 'GERMAN', 'france': 'FRENCH',
  'italy': 'ITALIAN', 'spain': 'SPANISH', 'canada': 'CANADIAN', 'australia': 'AUSTRALIAN', 'new zealand': 'NEW ZEALAND', 'ireland': 'IRISH',
  'brazil': 'BRAZILIAN', 'mexico': 'MEXICAN', 'argentina': 'ARGENTINE', 'chile': 'CHILEAN', 'colombia': 'COLOMBIAN', 'peru': 'PERUVIAN',
  'venezuela': 'VENEZUELAN', 'cuba': 'CUBAN', 'turkey': 'TURKISH', 'türkiye': 'TURKISH', 'israel': 'ISRAELI', 'iran': 'IRANIAN', 'iraq': 'IRAQI',
  'saudi arabia': 'SAUDI', 'egypt': 'EGYPTIAN', 'pakistan': 'PAKISTANI', 'bangladesh': 'BANGLADESHI', 'sri lanka': 'SRI LANKAN', 'nepal': 'NEPALESE',
  'afghanistan': 'AFGHAN', 'indonesia': 'INDONESIAN', 'malaysia': 'MALAYSIAN', 'singapore': 'SINGAPOREAN', 'thailand': 'THAI', 'vietnam': 'VIETNAMESE',
  'the philippines': 'PHILIPPINE', 'philippines': 'PHILIPPINE', 'south korea': 'SOUTH KOREAN', 'north korea': 'NORTH KOREAN', 'taiwan': 'TAIWANESE',
  'poland': 'POLISH', 'the netherlands': 'DUTCH', 'netherlands': 'DUTCH', 'belgium': 'BELGIAN', 'sweden': 'SWEDISH', 'norway': 'NORWEGIAN',
  'denmark': 'DANISH', 'finland': 'FINNISH', 'greece': 'GREEK', 'portugal': 'PORTUGUESE', 'switzerland': 'SWISS', 'austria': 'AUSTRIAN',
  'hungary': 'HUNGARIAN', 'romania': 'ROMANIAN', 'czech republic': 'CZECH', 'south africa': 'SOUTH AFRICAN', 'nigeria': 'NIGERIAN', 'kenya': 'KENYAN',
  'ethiopia': 'ETHIOPIAN', 'ghana': 'GHANAIAN', 'morocco': 'MOROCCAN', 'algeria': 'ALGERIAN', 'lebanon': 'LEBANESE', 'jordan': 'JORDANIAN',
  'syria': 'SYRIAN', 'qatar': 'QATARI', 'the united arab emirates': 'EMIRATI', 'the uae': 'EMIRATI', 'kazakhstan': 'KAZAKH', 'georgia': 'GEORGIAN',
  'armenia': 'ARMENIAN', 'azerbaijan': 'AZERBAIJANI', 'serbia': 'SERBIAN', 'croatia': 'CROATIAN', 'bulgaria': 'BULGARIAN', 'lithuania': 'LITHUANIAN',
  'latvia': 'LATVIAN', 'estonia': 'ESTONIAN', 'palestine': 'PALESTINIAN', 'myanmar': 'MYANMAR', 'cambodia': 'CAMBODIAN', 'mongolia': 'MONGOLIAN',
};

// Roles that take "of <country>". Longest first so "Vice President" beats "President".
const ROLES = [
  'Deputy Prime Minister', 'Prime Minister', 'Vice President', 'President', 'Chancellor', 'Foreign Minister', 'Defence Minister', 'Defense Minister',
  'Finance Minister', 'Interior Minister', 'Minister of Foreign Affairs', 'Minister of Defence', 'Minister of Defense', 'Secretary of State',
  'Secretary of Defense', 'Secretary of Defence', 'Governor', 'Senator', 'Mayor', 'Speaker', 'King', 'Queen', 'Crown Prince', 'Emir', 'Sultan',
].sort((a, b) => b.length - a.length);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COUNTRY_RE = Object.keys(DEMONYMS).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const ROLE_OF_COUNTRY = new RegExp(`\\b(former\\s+|acting\\s+|ex-)?(${ROLES.map(escapeRe).join('|')})\\s+(?:of|for)\\s+(${COUNTRY_RE})(?![\\p{L}])`, 'iu');
const ORG_ROLE = /(?:^|[.\n|•]\s*)(former\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3})\s+(CEO|Chairman|Chairwoman|Chair|Founder|President|Chief Executive)\b(?!\s+of\b)/;
const CEO_OF = /\b(former\s+)?(CEO|Chairman|Chief Executive|Founder)\s+(?:and\s+\w+\s+)?(?:of|at)\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3})/;

export function suggestTitle(bio) {
  if (typeof bio !== 'string') return null;
  const text = bio.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  let m = ROLE_OF_COUNTRY.exec(text);
  if (m) {
    const former = m[1] ? 'FORMER ' : '';
    const role = m[2].toUpperCase().replace('DEFENSE', 'DEFENCE');
    return `${former}${DEMONYMS[m[3].toLowerCase()]} ${role}`.replace(/^FORMER FORMER /, 'FORMER ').trim();
  }
  m = ORG_ROLE.exec(text);
  if (m) return `${m[1] ? 'FORMER ' : ''}${m[2].toUpperCase()} ${m[3].toUpperCase()}`;
  m = CEO_OF.exec(text);
  if (m) return `${m[1] ? 'FORMER ' : ''}${m[3].toUpperCase()} ${m[2].toUpperCase()}`;
  return null;
}
