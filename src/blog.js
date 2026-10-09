// Articles de blog (SEO) : le contenu est dans views/blog/<slug>.html.

const fs = require('node:fs');
const path = require('node:path');

const ARTICLES = [
  {
    slug: 'dormir-avec-de-la-musique',
    title: "Comment s'endormir avec de la musique sans écouteurs qui font mal",
    description: 'Écouteurs qui gênent sur le côté, qui tombent dans le lit : les solutions pour écouter musique, podcasts ou bruit blanc la nuit, confortablement.',
    date: '2026-10-01',
  },
  {
    slug: 'bruit-blanc-rose-brun',
    title: 'Bruit blanc, rose ou brun : lequel choisir pour s’endormir ?',
    description: 'Différences entre bruit blanc, rose et brun, et comment choisir le fond sonore qui vous aidera à masquer les bruits de la nuit.',
    date: '2026-10-03',
  },
  {
    slug: 'partenaire-qui-ronfle',
    title: 'Partenaire qui ronfle : 7 solutions pour enfin bien dormir',
    description: 'Bouchons, fond sonore, position, habitudes : des solutions concrètes pour mieux dormir à côté de quelqu’un qui ronfle.',
    date: '2026-10-06',
  },
];

function findArticle(slug) {
  return ARTICLES.find((a) => a.slug === slug);
}

function articleContent(slug) {
  return fs.readFileSync(path.join(__dirname, '..', 'views', 'blog', `${slug}.html`), 'utf8');
}

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

module.exports = { ARTICLES, findArticle, articleContent, formatDate };
