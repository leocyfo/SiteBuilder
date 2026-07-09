function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let nextBlockId = 1;
function makeBlockId() {
  return `b${Date.now()}${nextBlockId++}`;
}

function toEmbedUrl(url) {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return url;
}

// registre des types de bloc disponibles dans la palette — un seul endroit à
// modifier pour ajouter un type de bloc (palette, valeurs par défaut, rendu,
// panneau de propriétés utilisent tous ce registre)
const BLOCK_DEFS = {
  heading: {
    label: 'Titre',
    icon: 'H',
    defaults: () => ({ type: 'heading', text: 'Titre de section', level: 2, align: 'left', style: 'default' }),
    render: b => {
      const styleClass = b.style && b.style !== 'default' ? ` blk-heading-${b.style}` : '';
      // niveau validé/borné à 1-3 (les seules options du panneau) : une
      // donnée corrompue/importée ne doit jamais produire une balise
      // invalide ou casser hors de la balise
      const level = [1, 2, 3].includes(Number(b.level)) ? Number(b.level) : 2;
      return `<h${level} class="blk-heading blk-align-${b.align}${styleClass}">${escapeHtml(b.text)}</h${level}>`;
    },
  },
  paragraph: {
    label: 'Paragraphe',
    icon: 'P',
    defaults: () => ({ type: 'paragraph', text: 'Texte de paragraphe à personnaliser.', align: 'left', style: 'default' }),
    render: b => `<p class="blk-paragraph blk-align-${b.align} blk-paragraph-${b.style || 'default'}">${escapeHtml(b.text)}</p>`,
  },
  button: {
    label: 'Bouton',
    icon: '▭',
    defaults: () => ({ type: 'button', text: 'Cliquez ici', href: '#', style: 'primary' }),
    render: b => `<a class="blk-button blk-button-${b.style || 'primary'}" href="${escapeHtml(b.href)}">${escapeHtml(b.text)}</a>`,
  },
  image: {
    label: 'Image',
    icon: '▨',
    defaults: () => ({ type: 'image', src: '', alt: '', style: 'default' }),
    render: b => b.src
      ? `<img class="blk-image blk-image-${b.style || 'default'}" src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}">`
      : `<div class="blk-image-empty">Aucune image (renseigner une URL dans les propriétés)</div>`,
  },
  section: {
    label: 'Bande',
    icon: '▬',
    defaults: () => ({ type: 'section', background: '#5b9fe8', padding: 'md', style: 'solid' }),
    render: b => {
      if (b.style === 'gradient') return `<div class="blk-section blk-padding-${b.padding} blk-section-gradient"></div>`;
      if (b.style === 'outline') return `<div class="blk-section blk-padding-${b.padding} blk-section-outline" style="border-color:${escapeHtml(b.background)}"></div>`;
      return `<div class="blk-section blk-padding-${b.padding}" style="background:${escapeHtml(b.background)}"></div>`;
    },
  },
  quote: {
    label: 'Citation',
    icon: '"',
    defaults: () => ({ type: 'quote', text: 'Une citation inspirante.', author: '', style: 'default' }),
    render: b => `<blockquote class="blk-quote blk-quote-${b.style || 'default'}"><p>${escapeHtml(b.text)}</p>${b.author ? `<cite>— ${escapeHtml(b.author)}</cite>` : ''}</blockquote>`,
  },
  list: {
    label: 'Liste',
    icon: '≡',
    defaults: () => ({ type: 'list', items: ['Premier élément', 'Deuxième élément', 'Troisième élément'], style: 'bullet' }),
    render: b => {
      const style = b.style || 'bullet';
      const tag = style === 'numbered' ? 'ol' : 'ul';
      const itemsHtml = b.items.map(i => `<li>${escapeHtml(i)}</li>`).join('');
      return `<${tag} class="blk-list blk-list-${style}">${itemsHtml}</${tag}>`;
    },
  },
  divider: {
    label: 'Séparateur',
    icon: '—',
    defaults: () => ({ type: 'divider', style: 'solid' }),
    render: b => `<hr class="blk-divider blk-divider-${b.style || 'solid'}">`,
  },
  card: {
    label: 'Carte',
    icon: '▣',
    defaults: () => ({ type: 'card', title: 'Titre de la carte', text: 'Description courte de la carte.', style: 'default' }),
    // fond transparent si une couleur de fond personnalisée est choisie
    // (Apparence) : sinon var(--page-panel), codé en dur dans .blk-card,
    // recouvrirait entièrement cette couleur
    render: b => `<div class="blk-card blk-card-${b.style || 'default'}"${b.bgColor ? ' style="background:transparent;"' : ''}><h3 class="blk-card-title">${escapeHtml(b.title)}</h3><p class="blk-card-text">${escapeHtml(b.text)}</p></div>`,
  },
  columns: {
    label: '2 colonnes',
    icon: '❘❘',
    defaults: () => ({ type: 'columns', leftTitle: 'Colonne 1', leftText: 'Texte de la première colonne.', rightTitle: 'Colonne 2', rightText: 'Texte de la seconde colonne.', style: 'default' }),
    render: b => `<div class="blk-columns blk-columns-${b.style || 'default'}">
      <div class="blk-column"><h4>${escapeHtml(b.leftTitle)}</h4><p>${escapeHtml(b.leftText)}</p></div>
      <div class="blk-column"><h4>${escapeHtml(b.rightTitle)}</h4><p>${escapeHtml(b.rightText)}</p></div>
    </div>`,
  },
  video: {
    label: 'Vidéo',
    icon: '▶',
    defaults: () => ({ type: 'video', url: '' }),
    render: b => b.url
      ? `<div class="blk-video"><iframe src="${escapeHtml(toEmbedUrl(b.url))}" allowfullscreen loading="lazy"></iframe></div>`
      : `<div class="blk-image-empty">Aucune vidéo (renseigner une URL dans les propriétés)</div>`,
  },
  sidebar: {
    label: 'Barre latérale',
    icon: '☰',
    // side 'left'/'right' : le bloc se fixe sur ce bord, pleine hauteur (voir
    // renderBlockContent) ; 'none' : se comporte comme un bloc normal (x/y libres)
    defaults: () => ({
      type: 'sidebar', side: 'left', width: 260, brand: 'Marque',
      showSearch: true, showFooter: true, activeIndex: 0,
      items: ['Tableau de bord', 'Projets', 'Notifications', 'Analytique', 'Favoris', 'Messages'],
    }),
    render: b => {
      // Number() : une valeur non numérique (donnée corrompue, ou NaN suite à
      // une saisie invalide dans le champ — voir script.js) ne doit
      // silencieusement matcher aucun élément plutôt que planter
      const activeIndex = Number(b.activeIndex);
      const itemsHtml = b.items.map((label, i) => `
        <div class="blk-sidebar-item${i === activeIndex ? ' active' : ''}"><span class="blk-sidebar-dot"></span>${escapeHtml(label)}</div>
      `).join('');
      const initial = (b.brand || '').trim().charAt(0).toUpperCase() || 'S';
      // fond transparent si une couleur de fond personnalisée est choisie
      // (Apparence) : sinon var(--page-panel), codé en dur dans .blk-sidebar,
      // recouvrirait entièrement cette couleur (bloc plein cadre, opaque)
      const bgOverride = b.bgColor ? ' style="background:transparent;"' : '';
      return `<div class="blk-sidebar"${bgOverride}>
        <div class="blk-sidebar-brand"><span class="blk-sidebar-logo">${escapeHtml(initial)}</span><span>${escapeHtml(b.brand)}</span></div>
        ${b.showSearch ? '<div class="blk-sidebar-search">Rechercher…</div>' : ''}
        <nav class="blk-sidebar-nav">${itemsHtml}</nav>
        ${b.showFooter ? '<div class="blk-sidebar-footer">Déconnexion</div>' : ''}
      </div>`;
    },
  },
  navbar: {
    label: 'Barre de navigation',
    icon: '▤',
    // side 'top' : se fixe en haut, pleine largeur (voir renderBlockContent) ; 'none' : bloc libre
    defaults: () => ({
      type: 'navbar', side: 'top', height: 64, brand: 'Marque', activeIndex: 0,
      items: ['Accueil', 'Produits', 'Tarifs', 'Contact'], showButton: true, buttonText: 'Commencer',
    }),
    render: b => {
      const activeIndex = Number(b.activeIndex);
      const itemsHtml = b.items.map((label, i) => `<div class="blk-navbar-item${i === activeIndex ? ' active' : ''}">${escapeHtml(label)}</div>`).join('');
      const bgOverride = b.bgColor ? ' style="background:transparent;"' : '';
      return `<div class="blk-navbar"${bgOverride}>
        <div class="blk-navbar-brand">${escapeHtml(b.brand)}</div>
        <nav class="blk-navbar-nav">${itemsHtml}</nav>
        ${b.showButton ? `<a class="blk-button blk-button-primary blk-navbar-btn">${escapeHtml(b.buttonText)}</a>` : ''}
      </div>`;
    },
  },
  footer: {
    label: 'Pied de page',
    icon: '▥',
    // side 'bottom' : se fixe en bas, pleine largeur (voir renderBlockContent) ; 'none' : bloc libre
    defaults: () => ({
      type: 'footer', side: 'bottom', height: 70,
      text: '© 2026 Marque. Tous droits réservés.', items: ['Confidentialité', 'Conditions', 'Contact'],
    }),
    render: b => {
      const itemsHtml = b.items.map(label => `<span class="blk-footer-link">${escapeHtml(label)}</span>`).join('');
      const bgOverride = b.bgColor ? ' style="background:transparent;"' : '';
      return `<div class="blk-footer"${bgOverride}>
        <span class="blk-footer-text">${escapeHtml(b.text)}</span>
        <div class="blk-footer-links">${itemsHtml}</div>
      </div>`;
    },
  },
  gallery: {
    label: 'Galerie',
    icon: '▦',
    defaults: () => ({ type: 'gallery', images: [], columns: 3 }),
    render: b => {
      if (!b.images.length) return `<div class="blk-image-empty">Aucune image (ajouter des URLs dans les propriétés)</div>`;
      const imgs = b.images.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('');
      return `<div class="blk-gallery" style="grid-template-columns:repeat(${Number(b.columns) || 3},1fr)">${imgs}</div>`;
    },
  },
  accordion: {
    label: 'Accordéon',
    icon: '▾',
    // <details>/<summary> : natif, dépliable au clic sans une ligne de JS,
    // fonctionne aussi bien dans l'éditeur que dans le HTML exporté
    defaults: () => ({
      type: 'accordion',
      items: [
        { q: 'Première question', a: 'Réponse à la première question.' },
        { q: 'Deuxième question', a: 'Réponse à la deuxième question.' },
      ],
    }),
    render: b => {
      // chaque item a son propre fond opaque codé en dur (.blk-accordion-item) :
      // sans le neutraliser, une couleur de fond personnalisée (Apparence) sur
      // le bloc entier resterait invisible derrière eux, comme pour card/sidebar
      const itemStyle = b.bgColor ? ' style="background:transparent;"' : '';
      const itemsHtml = b.items.map(item => `<details class="blk-accordion-item"${itemStyle}><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(item.a)}</p></details>`).join('');
      return `<div class="blk-accordion">${itemsHtml}</div>`;
    },
  },
  contactForm: {
    label: 'Formulaire de contact',
    icon: '✉',
    // action="mailto:" : fonctionne réellement sans backend (ouvre le client
    // mail de l'utilisateur avec le message pré-rempli), plutôt qu'une
    // fausse apparence de formulaire qui ne ferait rien au clic
    defaults: () => ({ type: 'contactForm', title: 'Contactez-nous', email: '', buttonText: 'Envoyer' }),
    render: b => `<form class="blk-contact-form" action="mailto:${escapeHtml(b.email)}" method="post" enctype="text/plain">
      <h3>${escapeHtml(b.title)}</h3>
      <input type="text" placeholder="Votre nom" name="nom">
      <input type="email" placeholder="Votre email" name="email">
      <textarea placeholder="Votre message" name="message" rows="4"></textarea>
      <button type="submit" class="blk-button blk-button-primary">${escapeHtml(b.buttonText)}</button>
    </form>`,
  },
};

// hauteur par défaut d'un bloc fixé en haut/bas (utilisée à la fois par
// computePinOffsets et par renderBlockContent : une seule source pour éviter
// que les deux calculs divergent si height est absent/effacé)
const PIN_DEFAULT_HEIGHT = { navbar: 64, footer: 70 };

// types de bloc pouvant se fixer sur un bord du canevas (voir isPinnedBlock/
// renderBlockContent) — chacun avec son propre jeu de côtés valides
const PINNABLE_SIDES = {
  sidebar: ['left', 'right'],
  navbar: ['top'],
  footer: ['bottom'],
};

// préréglages d'ombre portée (voir champ "shadow" du panneau Apparence)
const SHADOW_PRESETS = {
  none: 'none',
  sm: '0 2px 8px rgba(0,0,0,0.15)',
  md: '0 8px 20px rgba(0,0,0,0.25)',
  lg: '0 16px 40px rgba(0,0,0,0.35)',
};
const SHADOW_LABELS = { none: 'Aucune', sm: 'Légère', md: 'Moyenne', lg: 'Prononcée' };

// clonage profond de blocs — tous les champs sont des types sérialisables en
// JSON (string/number/boolean/null/tableau de strings), donc suffisant pour
// dupliquer un bloc ou prendre un instantané pour l'historique annuler/rétablir
function cloneBlocks(blocks) {
  return JSON.parse(JSON.stringify(blocks));
}

function createBlock(type) {
  const def = BLOCK_DEFS[type];
  // x/y (position libre en px sur le canevas), width/height (px, height
  // null = auto) et locked sont génériques à tous les types de bloc, tout
  // comme les champs d'apparence ci-dessous (null = pas de surcharge, le
  // bloc garde l'apparence du type/thème) — voir le wrapper .blk-resizable
  // dans renderBlockContent
  return {
    id: makeBlockId(), x: 40, y: 40, width: 400, height: null, locked: false,
    bgColor: null, textColor: null, borderColor: null, radius: null, shadow: 'none', opacity: 100,
    ...def.defaults(),
  };
}

// enveloppe le rendu propre au type (BLOCK_DEFS[type].render) dans un
// conteneur positionné librement (x/y), dimensionné (width/height) et
// habillé (couleurs/rayon/ombre/opacité) — partagé entre l'aperçu en direct
// et l'export, pour que les deux restent identiques. .page-canvas
// (position:relative) est le repère de positionnement dans les deux cas :
// en édition, .block-wrapper qui l'entoure n'a lui-même aucun
// positionnement, donc ce div s'y place directement sans décalage
// hauteurs occupées par une éventuelle navbar fixée en haut / footer fixé en
// bas parmi TOUS les blocs de la page — permet à une barre latérale fixée de
// s'insérer entre les deux plutôt que de les recouvrir (voir renderBlockContent)
function computePinOffsets(allBlocks) {
  const navbar = allBlocks.find(b => b.type === 'navbar' && b.side === 'top');
  const footer = allBlocks.find(b => b.type === 'footer' && b.side === 'bottom');
  return {
    top: navbar ? (navbar.height || PIN_DEFAULT_HEIGHT.navbar) : 0,
    bottom: footer ? (footer.height || PIN_DEFAULT_HEIGHT.footer) : 0,
  };
}

// allBlocks (tous les blocs de la page) est optionnel : sans lui, une barre
// latérale fixée retombe sur toute la hauteur (comportement précédent) —
// script.js le fournit toujours en pratique (canevas et export)
function renderBlockContent(block, allBlocks) {
  const inner = BLOCK_DEFS[block.type].render(block);
  // échappées : ce sont des couleurs choisies par l'utilisateur dans le
  // panneau Apparence, mais un fichier de projet importé/corrompu pourrait
  // contenir n'importe quelle chaîne — sans échappement, une valeur comme
  // `red;" onmouseover="…` sortirait de l'attribut style
  const bgStyle = block.bgColor ? `background:${escapeHtml(block.bgColor)};` : '';
  const colorStyle = block.textColor ? `color:${escapeHtml(block.textColor)};` : '';
  const borderStyle = block.borderColor ? `border:2px solid ${escapeHtml(block.borderColor)};` : '';
  const radiusStyle = (block.radius || block.radius === 0) ? `border-radius:${block.radius}px;` : '';
  const shadowStyle = block.shadow && block.shadow !== 'none' ? `box-shadow:${SHADOW_PRESETS[block.shadow]};` : '';
  const opacityStyle = (block.opacity !== undefined && block.opacity !== null && block.opacity !== 100) ? `opacity:${block.opacity / 100};` : '';

  // un bloc fixable (sidebar/navbar/footer) avec un côté choisi ignore x/y :
  // il se fixe sur ce bord et épouse toute la largeur ou hauteur du canevas
  // (voir aussi updateCanvasHeight, qui l'exclut pour éviter une boucle de
  // croissance) ; gauche/droite épousent la hauteur (barre latérale, mais en
  // s'arrêtant avant une éventuelle navbar/footer fixés plutôt que de les
  // recouvrir), haut/bas épousent la largeur (navigation/pied de page)
  const isPinned = (PINNABLE_SIDES[block.type] || []).includes(block.side);
  let positionStyle;
  if (isPinned && (block.side === 'left' || block.side === 'right')) {
    const offsets = computePinOffsets(allBlocks || [block]);
    positionStyle = `position:absolute; top:${offsets.top}px; bottom:${offsets.bottom}px; ${block.side}:0; width:${block.width || 260}px;`;
  } else if (isPinned) {
    const defaultHeight = PIN_DEFAULT_HEIGHT[block.type] || 64;
    positionStyle = `position:absolute; left:0; right:0; ${block.side}:0; height:${block.height || defaultHeight}px;`;
  } else {
    // x/y de secours pour un bloc importé/legacy antérieur à ces champs
    // génériques (sinon "left:undefinedpx" — silencieusement ignoré par le
    // navigateur, mais le bloc se retrouve visuellement à l'origine du canevas)
    positionStyle = `position:absolute; left:${block.x || 0}px; top:${block.y || 0}px; width:${block.width || 400}px; ${block.height ? `height:${block.height}px;` : ''}`;
  }

  const style = `${positionStyle}${bgStyle}${colorStyle}${borderStyle}${radiusStyle}${shadowStyle}${opacityStyle} box-sizing:border-box;`;
  return `<div class="blk-resizable" style="${style}">${inner}</div>`;
}

// CSS des blocs eux-mêmes (pas le chrome de l'éditeur) — injectée une fois
// dans le <head> pour l'aperçu en direct (voir injectPageCss dans script.js),
// et copiée telle quelle dans le document exporté, pour garantir que
// export == ce que montre l'aperçu
const PAGE_CSS = `
.page-canvas{
  position: relative;
  background: var(--page-bg);
  color: var(--page-text);
  font-family: var(--page-bodyFont);
  min-height: 400px;
}
.page-canvas h1.blk-heading{ font-size: 34px; }
.page-canvas h2.blk-heading{ font-size: 25px; }
.page-canvas h3.blk-heading{ font-size: 19px; }
.blk-heading{
  font-family: var(--page-headingFont);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
}
.blk-heading-accent{ color: var(--page-accent); }
.blk-heading-underline{ position: relative; padding-bottom: 12px; }
.blk-heading-underline::after{
  content: ''; position: absolute; left: 0; bottom: 0;
  width: 56px; height: 3px; background: var(--page-accent);
}
.blk-align-center.blk-heading-underline::after{ left: 50%; transform: translateX(-50%); }
.blk-align-right.blk-heading-underline::after{ left: auto; right: 0; }

.blk-paragraph{
  font-family: var(--page-bodyFont);
  line-height: 1.6;
  margin: 0;
}
.blk-paragraph-muted{ opacity: 0.7; }
.blk-paragraph-lead{ font-size: 19px; line-height: 1.5; }

/* le positionnement horizontal (largeur/marge) est géré par .blk-resizable
   (voir renderBlockContent) — ces classes ne gèrent plus que l'alignement du
   texte, pour ne pas entrer en conflit avec la marge choisie par l'utilisateur */
.blk-align-left{ text-align: left; }
.blk-align-center{ text-align: center; }
.blk-align-right{ text-align: right; }

.blk-button{
  display: inline-block;
  width: fit-content;
  padding: 10px 22px;
  border-radius: var(--page-radius);
  font-family: var(--page-bodyFont);
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
}
.blk-button-primary{ background: var(--page-accent); color: #fff; }
.blk-button-secondary{ background: transparent; color: var(--page-accent); border: 1px solid var(--page-accent); }
.blk-button-ghost{ background: transparent; color: var(--page-accent); padding-left: 4px; padding-right: 4px; }

.blk-image{ max-width: 100%; display: block; border-radius: var(--page-radius); }
.blk-image-square{ border-radius: 0; }
.blk-image-circle{ border-radius: 50%; aspect-ratio: 1 / 1; object-fit: cover; max-width: 220px; }
.blk-image-empty{
  border: 1px dashed var(--page-border);
  border-radius: var(--page-radius);
  padding: 40px;
  text-align: center;
  color: var(--page-textDim);
  font-family: var(--page-bodyFont);
  font-size: 13px;
}

.blk-section{ border-radius: var(--page-radius); }
.blk-padding-sm{ height: 24px; }
.blk-padding-md{ height: 56px; }
.blk-padding-lg{ height: 100px; }
.blk-section-gradient{ background: linear-gradient(135deg, var(--page-accent), transparent); }
.blk-section-outline{ background: transparent; border: 2px solid; }

.blk-quote{ font-family: var(--page-bodyFont); margin: 0; }
.blk-quote p{ font-size: 18px; font-style: italic; line-height: 1.5; margin: 0 0 8px; }
.blk-quote cite{ font-size: 13px; font-style: normal; color: var(--page-textDim); }
.blk-quote-accent-bar{ border-left: 4px solid var(--page-accent); padding-left: 18px; }
.blk-quote-centered{ text-align: center; }

.blk-list{ font-family: var(--page-bodyFont); line-height: 1.7; padding-left: 22px; margin: 0; }
.blk-list-bullet{ list-style: disc; }
.blk-list-numbered{ list-style: decimal; }
.blk-list-check{ list-style: none; padding-left: 0; }
.blk-list-check li{ position: relative; padding-left: 26px; }
.blk-list-check li::before{ content: '✓'; position: absolute; left: 0; color: var(--page-accent); font-weight: 700; }

.blk-divider{ border: none; border-top-width: 1px; border-color: var(--page-border); margin: 0; width: 100%; }
.blk-divider-solid{ border-top-style: solid; }
.blk-divider-dashed{ border-top-style: dashed; }
.blk-divider-dotted{ border-top-style: dotted; }

.blk-card{ background: var(--page-panel); border-radius: var(--page-radius); padding: 22px; }
.blk-card-title{ font-family: var(--page-headingFont); font-weight: 700; font-size: 17px; margin: 0 0 8px; }
.blk-card-text{ font-family: var(--page-bodyFont); font-size: 13.5px; line-height: 1.5; color: var(--page-textDim); margin: 0; }
.blk-card-bordered{ border: 1px solid var(--page-border); }
.blk-card-shadow{ box-shadow: 0 8px 24px rgba(0,0,0,0.18); }

.blk-columns{ display: grid; grid-template-columns: 1fr 1fr; gap: 28px; position: relative; }
.blk-column h4{ font-family: var(--page-headingFont); font-weight: 700; font-size: 15px; margin: 0 0 6px; }
.blk-column p{ font-family: var(--page-bodyFont); font-size: 13.5px; line-height: 1.55; margin: 0; }
.blk-columns-divided::before{
  content: ''; position: absolute; left: 50%; top: 0; bottom: 0;
  width: 1px; background: var(--page-border);
}

.blk-video{ position: relative; width: 100%; padding-top: 56.25%; border-radius: var(--page-radius); overflow: hidden; background: #000; }
.blk-video iframe{ position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

.blk-sidebar{
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--page-panel);
  padding: 20px 16px;
  box-sizing: border-box;
  overflow-y: auto;
  font-family: var(--page-bodyFont);
}
.blk-sidebar-brand{
  display: flex; align-items: center; gap: 10px;
  font-family: var(--page-headingFont);
  font-weight: 700;
  font-size: 14px;
}
.blk-sidebar-logo{
  width: 28px; height: 28px;
  border-radius: var(--page-radius);
  background: var(--page-accent);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  flex-shrink: 0;
}
.blk-sidebar-search{
  font-size: 12.5px;
  color: var(--page-textDim);
  background: var(--page-bg);
  border: 1px solid var(--page-border);
  border-radius: var(--page-radius);
  padding: 8px 10px;
}
.blk-sidebar-nav{ display: flex; flex-direction: column; gap: 4px; flex: 1; }
.blk-sidebar-item{
  display: flex; align-items: center; gap: 10px;
  font-size: 13px;
  color: var(--page-textDim);
  padding: 9px 10px;
  border-radius: var(--page-radius);
}
.blk-sidebar-item.active{ background: var(--page-accent); color: #fff; font-weight: 600; }
.blk-sidebar-dot{ width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.6; flex-shrink: 0; }
.blk-sidebar-item.active .blk-sidebar-dot{ opacity: 1; }
.blk-sidebar-footer{
  font-size: 12.5px;
  color: var(--page-textDim);
  padding-top: 14px;
  border-top: 1px solid var(--page-border);
}

.blk-navbar{
  height: 100%;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  background: var(--page-panel);
  box-sizing: border-box;
  font-family: var(--page-bodyFont);
}
.blk-navbar-brand{ font-family: var(--page-headingFont); font-weight: 700; font-size: 16px; margin-right: auto; }
.blk-navbar-nav{ display: flex; gap: 20px; }
.blk-navbar-item{ font-size: 13.5px; color: var(--page-textDim); }
.blk-navbar-item.active{ color: var(--page-text); font-weight: 600; }
.blk-navbar-btn{ padding: 8px 16px; font-size: 13px; }

.blk-footer{
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
  background: var(--page-panel);
  border-top: 1px solid var(--page-border);
  box-sizing: border-box;
  font-family: var(--page-bodyFont);
  font-size: 12.5px;
  color: var(--page-textDim);
}
.blk-footer-text{ color: var(--page-textDim); }
.blk-footer-link{ color: var(--page-textDim); }
.blk-footer-links{ display: flex; gap: 16px; }

.blk-gallery{ display: grid; gap: 10px; }
.blk-gallery img{ width: 100%; height: 120px; object-fit: cover; border-radius: var(--page-radius); display: block; }

.blk-accordion{ display: flex; flex-direction: column; gap: 8px; font-family: var(--page-bodyFont); }
.blk-accordion-item{
  background: var(--page-panel);
  border: 1px solid var(--page-border);
  border-radius: var(--page-radius);
  padding: 12px 14px;
}
.blk-accordion-item summary{ font-size: 13.5px; font-weight: 600; cursor: pointer; }
.blk-accordion-item p{ font-size: 13px; color: var(--page-textDim); margin: 10px 0 0; line-height: 1.5; }

.blk-contact-form{ display: flex; flex-direction: column; gap: 10px; font-family: var(--page-bodyFont); }
.blk-contact-form h3{ font-family: var(--page-headingFont); font-size: 17px; font-weight: 700; margin: 0 0 4px; }
.blk-contact-form input,
.blk-contact-form textarea{
  font-family: var(--page-bodyFont);
  font-size: 13px;
  padding: 9px 11px;
  border: 1px solid var(--page-border);
  border-radius: var(--page-radius);
  background: var(--page-panel);
  color: var(--page-text);
  box-sizing: border-box;
}
.blk-contact-form button{ align-self: flex-start; border: none; cursor: pointer; }
`;
