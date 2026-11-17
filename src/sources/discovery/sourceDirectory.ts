export interface DirectorySourceEntry {
  id: string;
  name: string;
  url: string;
  format: 'RSS' | 'Atom';
  categoryId: string;
  description: string;
}

export const SOURCE_DIRECTORY: DirectorySourceEntry[] = [
  {
    id: 'dir-bbc-world',
    name: 'BBC News — World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    format: 'RSS',
    categoryId: 'world',
    description: 'International breaking news, diplomacy, and regional dispatches.',
  },
  {
    id: 'dir-npr-national',
    name: 'NPR News',
    url: 'https://feeds.npr.org/1001/rss.xml',
    format: 'RSS',
    categoryId: 'national',
    description: 'National reporting, public policy, and feature audio transcripts.',
  },
  {
    id: 'dir-nasa-breaking',
    name: 'NASA Breaking News',
    url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    format: 'RSS',
    categoryId: 'space',
    description: 'Orbital missions, planetary probes, and astrophysics bulletins.',
  },
  {
    id: 'dir-esa-space',
    name: 'European Space Agency',
    url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News',
    format: 'RSS',
    categoryId: 'space',
    description: 'Launch telemetry, Earth observation, and deep-space missions.',
  },
  {
    id: 'dir-ars-tech',
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    format: 'RSS',
    categoryId: 'technology',
    description: 'Computing architecture, security engineering, and science policy.',
  },
  {
    id: 'dir-nature-science',
    name: 'Nature Research Highlights',
    url: 'https://www.nature.com/nature.rss',
    format: 'RSS',
    categoryId: 'science',
    description: 'Peer-reviewed discoveries across physics, biology, and Earth systems.',
  },
];
