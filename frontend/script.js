// le thème est partagé par tout le projet (un site = un habillage cohérent) ;
// seuls les blocs diffèrent d'une page à l'autre — voir getBlocks/setBlocks
let state = {
  name: 'Sans titre',
  theme: THEMES[0].id,
  pages: [{ name: 'Page 1', blocks: [] }],
  currentPageIndex: 0,
  selectedId: null,
};

// accesseurs pour les blocs de la page actuelle — un seul endroit à changer
// si la forme de state.pages évolue ; getBlocks() renvoie la référence
// vivante du tableau (push/splice/filter fonctionnent dessus directement),
// setBlocks() sert uniquement aux réaffectations complètes (ex. après un filter)
function getBlocks() {
  return state.pages[state.currentPageIndex].blocks;
}
function setBlocks(arr) {
  state.pages[state.currentPageIndex].blocks = arr;
}

// historique annuler/rétablir : pile d'instantanés complets des blocs de la
// page actuelle (voir pushHistory/undo/redo) — plus simple et plus robuste
// qu'un suivi mutation par mutation, et couvre automatiquement tout futur
// champ de bloc. Changer de page réinitialise l'historique (comme charger
// un projet), annuler vers les blocs d'une autre page n'aurait pas de sens
let historyStack = [];
let historyIndex = -1;
let restoringHistory = false;
// vrai pendant un glisser (déplacement/redimensionnement) : bloque les
// raccourcis clavier pour éviter toute interférence avec le geste en cours
let gestureActive = false;
// presse-papiers interne (copier/couper/coller de blocs) — pasteCount permet
// à des collages répétés de décaler chaque copie plutôt que de les empiler
// exactement au même endroit
let clipboardBlock = null;
let pasteCount = 0;
// sélection multiple (Maj+clic) : ids en plus de state.selectedId, qui reste
// le "dernier cliqué" — voir toggleMultiSelect/renderMultiSelectProps
let multiSelectIds = new Set();

const HISTORY_LIMIT = 50;
const DUPLICATE_OFFSET = 20;
const SNAP_THRESHOLD = 6;
const NUDGE_STEP = 1;
const NUDGE_STEP_SHIFT = 10;

// liste affichée dans le panneau "Raccourcis" (bouton de la barre du haut)
const SHORTCUTS = [
  ['Ctrl+Z', 'Annuler'],
  ['Ctrl+Y / Ctrl+Maj+Z', 'Rétablir'],
  ['Ctrl+C', 'Copier le bloc sélectionné'],
  ['Ctrl+X', 'Couper le bloc sélectionné'],
  ['Ctrl+V', 'Coller'],
  ['Ctrl+D', 'Dupliquer le bloc sélectionné'],
  ['Suppr / Retour arrière', 'Supprimer le(s) bloc(s) sélectionné(s)'],
  ['Flèches', 'Déplacer le bloc sélectionné (1px)'],
  ['Maj + Flèches', 'Déplacer le bloc sélectionné (10px)'],
  ['Maj + Clic', 'Ajouter/retirer un bloc de la sélection multiple'],
  ['Échap', 'Désélectionner / fermer ce panneau'],
];

const canvasEl = document.getElementById('pageCanvas');
const paletteListEl = document.getElementById('paletteList');
const propsPanelEl = document.getElementById('propsPanel');
const canvasHintEl = document.getElementById('canvasHint');
const themeSelectEl = document.getElementById('themeSelect');
const loadSelectEl = document.getElementById('loadSelect');
const projectNameEl = document.getElementById('projectName');

const ALIGN_OPTIONS = [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']];
// #rgb ou #rrggbb — validation du champ hex texte accolé à chaque sélecteur
// de couleur (voir bindColorField)
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function expandHexColor(v) {
  return v.length === 4 ? '#' + [...v.slice(1)].map(c => c + c).join('') : v.toLowerCase();
}

const PROP_SCHEMAS = {
  heading: [
    { key: 'text', label: 'Texte', type: 'textarea' },
    { key: 'level', label: 'Niveau', type: 'select', numeric: true, options: [[1, 'H1 (grand titre)'], [2, 'H2'], [3, 'H3']] },
    { key: 'align', label: 'Alignement', type: 'select', options: ALIGN_OPTIONS },
    { key: 'style', label: 'Style', type: 'select', options: [['default', 'Normal'], ['accent', 'Couleur accent'], ['underline', 'Soulignement accent']] },
  ],
  paragraph: [
    { key: 'text', label: 'Texte', type: 'textarea' },
    { key: 'align', label: 'Alignement', type: 'select', options: ALIGN_OPTIONS },
    { key: 'style', label: 'Style', type: 'select', options: [['default', 'Normal'], ['muted', 'Estompé'], ['lead', 'Intro (plus grand)']] },
  ],
  button: [
    { key: 'text', label: 'Texte du bouton', type: 'text' },
    { key: 'href', label: 'Lien (URL)', type: 'text' },
    { key: 'style', label: 'Style', type: 'select', options: [['primary', 'Plein'], ['secondary', 'Contour'], ['ghost', 'Texte seul']] },
  ],
  image: [
    { key: 'src', label: "URL de l'image", type: 'text' },
    { key: 'alt', label: 'Texte alternatif', type: 'text' },
    { key: 'style', label: 'Forme', type: 'select', options: [['default', 'Coins arrondis (thème)'], ['square', 'Coins carrés'], ['circle', 'Cercle']] },
  ],
  section: [
    { key: 'background', label: 'Couleur', type: 'color' },
    { key: 'padding', label: 'Hauteur', type: 'select', options: [['sm', 'Petite'], ['md', 'Moyenne'], ['lg', 'Grande']] },
    { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Plein'], ['outline', 'Contour'], ['gradient', 'Dégradé (accent)']] },
  ],
  quote: [
    { key: 'text', label: 'Citation', type: 'textarea' },
    { key: 'author', label: 'Auteur (optionnel)', type: 'text' },
    { key: 'style', label: 'Style', type: 'select', options: [['default', 'Normal'], ['accent-bar', 'Barre accent'], ['centered', 'Centré']] },
  ],
  list: [
    { key: 'items', label: 'Éléments (un par ligne)', type: 'list-items' },
    { key: 'style', label: 'Style', type: 'select', options: [['bullet', 'Puces'], ['numbered', 'Numéroté'], ['check', 'Coches']] },
  ],
  divider: [
    { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Trait plein'], ['dashed', 'Tirets'], ['dotted', 'Pointillés']] },
  ],
  card: [
    { key: 'title', label: 'Titre', type: 'text' },
    { key: 'text', label: 'Texte', type: 'textarea' },
    { key: 'style', label: 'Style', type: 'select', options: [['default', 'Normal'], ['bordered', 'Avec bordure'], ['shadow', 'Avec ombre']] },
  ],
  columns: [
    { key: 'leftTitle', label: 'Titre (colonne 1)', type: 'text' },
    { key: 'leftText', label: 'Texte (colonne 1)', type: 'textarea' },
    { key: 'rightTitle', label: 'Titre (colonne 2)', type: 'text' },
    { key: 'rightText', label: 'Texte (colonne 2)', type: 'textarea' },
    { key: 'style', label: 'Style', type: 'select', options: [['default', 'Normal'], ['divided', 'Avec séparateur']] },
  ],
  video: [
    { key: 'url', label: "URL de la vidéo (YouTube ou lien d'intégration)", type: 'text' },
  ],
  sidebar: [
    { key: 'side', label: 'Côté', type: 'select', options: [['left', 'Gauche (fixée)'], ['right', 'Droite (fixée)'], ['none', 'Libre (non fixée)']] },
    { key: 'brand', label: 'Nom / marque', type: 'text' },
    { key: 'items', label: 'Éléments du menu (un par ligne)', type: 'list-items' },
    { key: 'activeIndex', label: 'Élément actif (0 = premier)', type: 'text', numeric: true },
    { key: 'showSearch', label: 'Afficher la recherche', type: 'checkbox' },
    { key: 'showFooter', label: 'Afficher le pied (déconnexion)', type: 'checkbox' },
  ],
  navbar: [
    { key: 'side', label: 'Position', type: 'select', options: [['top', 'Haut (fixée)'], ['none', 'Libre (non fixée)']] },
    { key: 'brand', label: 'Nom / marque', type: 'text' },
    { key: 'items', label: 'Liens du menu (un par ligne)', type: 'list-items' },
    { key: 'activeIndex', label: 'Lien actif (0 = premier)', type: 'text', numeric: true },
    { key: 'showButton', label: 'Afficher le bouton', type: 'checkbox' },
    { key: 'buttonText', label: 'Texte du bouton', type: 'text' },
  ],
  footer: [
    { key: 'side', label: 'Position', type: 'select', options: [['bottom', 'Bas (fixé)'], ['none', 'Libre (non fixé)']] },
    { key: 'text', label: 'Texte (copyright)', type: 'text' },
    { key: 'items', label: 'Liens (un par ligne)', type: 'list-items' },
  ],
  gallery: [
    { key: 'images', label: "URLs des images (une par ligne)", type: 'list-items' },
    { key: 'columns', label: 'Colonnes', type: 'select', numeric: true, options: [[2, '2'], [3, '3'], [4, '4']] },
  ],
  accordion: [
    { key: 'items', label: 'Questions (format : Question | Réponse, une par ligne)', type: 'qa-items' },
  ],
  contactForm: [
    { key: 'title', label: 'Titre', type: 'text' },
    { key: 'email', label: 'Email de destination', type: 'text' },
    { key: 'buttonText', label: 'Texte du bouton', type: 'text' },
  ],
};

function findBlock(id) {
  return getBlocks().find(b => b.id === id);
}

// ---------- Palette ----------

// regroupement de la palette par catégorie — un type de bloc non listé ici
// retomberait silencieusement hors palette, donc à tenir à jour avec BLOCK_DEFS
const BLOCK_CATEGORIES = [
  { name: 'Texte', types: ['heading', 'paragraph', 'quote', 'list'] },
  { name: 'Média', types: ['image', 'video', 'gallery'] },
  { name: 'Mise en page', types: ['section', 'divider', 'columns', 'card'] },
  { name: 'Navigation', types: ['navbar', 'sidebar', 'footer'] },
  { name: 'Interactif', types: ['button', 'accordion', 'contactForm'] },
];

// catégories repliées (par nom) — persisté dans localStorage pour survivre
// à un rechargement de page (échec silencieux si localStorage indisponible,
// ex. navigation privée : la palette reste alors dépliée par défaut)
const PALETTE_COLLAPSED_KEY = 'sitebuilder-palette-collapsed';
function loadCollapsedCategories() {
  try {
    const raw = localStorage.getItem(PALETTE_COLLAPSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveCollapsedCategories() {
  try {
    localStorage.setItem(PALETTE_COLLAPSED_KEY, JSON.stringify([...collapsedCategories]));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : le repli ne
    // survivra pas au rechargement, tant pis, ce n'est pas bloquant
  }
}
const collapsedCategories = loadCollapsedCategories();

// filtre de recherche de la palette (#paletteSearch) : pendant une recherche,
// l'état replié/déplié des catégories est ignoré (tout résultat pertinent
// doit rester visible) et les catégories sans résultat disparaissent
let paletteSearchQuery = '';

function renderPalette() {
  const query = paletteSearchQuery.trim().toLowerCase();
  const filtering = query.length > 0;

  const categoriesHtml = BLOCK_CATEGORIES.map(cat => {
    const types = filtering
      ? cat.types.filter(type => BLOCK_DEFS[type] && BLOCK_DEFS[type].label.toLowerCase().includes(query))
      : cat.types;
    if (filtering && !types.length) return '';

    const collapsed = !filtering && collapsedCategories.has(cat.name);
    const itemsHtml = types.map(type => {
      const def = BLOCK_DEFS[type];
      if (!def) return '';
      return `<div class="palette-item" draggable="true" data-type="${type}"><span class="palette-item-icon">${escapeHtml(def.icon)}</span>${escapeHtml(def.label)}</div>`;
    }).join('');
    return `
      <div class="palette-category">
        <button type="button" class="palette-category-header" data-cat="${escapeHtml(cat.name)}" aria-expanded="${!collapsed}">
          <span class="palette-category-arrow${collapsed ? ' collapsed' : ''}">▾</span>
          ${escapeHtml(cat.name)}
        </button>
        <div class="palette-category-items${collapsed ? ' collapsed' : ''}">${itemsHtml}</div>
      </div>
    `;
  }).join('');

  paletteListEl.innerHTML = categoriesHtml.trim()
    ? categoriesHtml
    : '<p class="palette-empty">Aucun bloc trouvé.</p>';

  paletteListEl.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-block-type', item.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });
  paletteListEl.querySelectorAll('.palette-category-header').forEach(header => {
    header.addEventListener('click', () => {
      const cat = header.dataset.cat;
      if (collapsedCategories.has(cat)) collapsedCategories.delete(cat); else collapsedCategories.add(cat);
      saveCollapsedCategories();
      renderPalette();
    });
  });
}

function renderThemeSelect() {
  themeSelectEl.innerHTML = THEMES.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  themeSelectEl.value = state.theme;
}

// ---------- Canevas ----------

function render() {
  renderCanvas();
  renderProps();
  renderLayers();
}

// ---------- Panneau de calques ----------

// dernier bloc du tableau (rendu en dernier, donc visuellement au-dessus,
// voir bringToFront/sendToBack) affiché en premier dans la liste — même
// logique que les panneaux de calques habituels (Figma, Photoshop...)
function renderLayers() {
  const layersEl = document.getElementById('layersList');
  if (!layersEl) return;
  const blocks = [...getBlocks()].reverse();
  layersEl.innerHTML = blocks.map(b => `
    <div class="layer-item${b.id === state.selectedId ? ' selected' : ''}${multiSelectIds.has(b.id) ? ' multi-selected' : ''}" data-id="${b.id}" draggable="true">
      <span class="layer-item-icon">${escapeHtml(BLOCK_DEFS[b.type].icon)}</span>
      <span class="layer-item-label">${escapeHtml(layerLabel(b))}</span>
    </div>
  `).join('');

  layersEl.querySelectorAll('.layer-item').forEach(item => {
    const id = item.dataset.id;
    item.addEventListener('click', (e) => {
      if (e.shiftKey) { toggleMultiSelect(id); return; }
      // cohérent avec le mousedown du canevas : un clic simple sur un bloc
      // déjà dans une sélection multiple la préserve au lieu de la réduire
      if (multiSelectIds.size > 1 && multiSelectIds.has(id)) return;
      clearMultiSelect();
      selectBlock(id);
    });
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-layer-id', id);
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/x-layer-id');
      if (draggedId) reorderLayer(draggedId, id);
    });
  });
}

// libellé lisible d'un calque : le contenu du bloc quand c'est pertinent,
// sinon le nom générique du type
function layerLabel(b) {
  const def = BLOCK_DEFS[b.type];
  const text = b.text || b.title || b.brand;
  return text ? `${def.label} — ${String(text).slice(0, 24)}` : def.label;
}

// réordonne state.blocks — l'ordre du tableau pilote aussi l'empilement
// visuel (voir bringToFront/sendToBack), donc glisser dans les calques
// change réellement lequel est "devant"
function reorderLayer(draggedId, targetId) {
  if (draggedId === targetId) return;
  const blocks = getBlocks();
  const fromIdx = blocks.findIndex(b => b.id === draggedId);
  const toIdx = blocks.findIndex(b => b.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [block] = blocks.splice(fromIdx, 1);
  blocks.splice(toIdx, 0, block);
  pushHistory();
  render();
}

function renderCanvas() {
  applyTheme(canvasEl, state.theme);
  const blocks = getBlocks();
  canvasHintEl.style.display = blocks.length ? 'none' : 'block';

  canvasEl.innerHTML = blocks.map(block => `
    <div class="block-wrapper${block.id === state.selectedId && multiSelectIds.size <= 1 ? ' selected' : ''}${multiSelectIds.has(block.id) ? ' multi-selected' : ''}${block.locked ? ' locked' : ''}${isPinnedBlock(block) ? ' pinned' : ''}" data-id="${block.id}">
      <div class="selection-frame"></div>
      <div class="resize-handles">
        <div class="resize-handle rh-left" data-dir="left" draggable="false"></div>
        <div class="resize-handle rh-right" data-dir="right" draggable="false"></div>
        <div class="resize-handle rh-top" data-dir="top" draggable="false"></div>
        <div class="resize-handle rh-bottom" data-dir="bottom" draggable="false"></div>
      </div>
      ${renderBlockContent(block, blocks)}
    </div>
  `).join('');

  canvasEl.querySelectorAll('.block-wrapper').forEach(wrapper => {
    const id = wrapper.dataset.id;
    // navigation/soumission bloquées : le bloc "Bouton" rend un vrai <a href>
    // et "Formulaire de contact" un vrai <form action="mailto:">, sans ça un
    // clic dans l'éditeur suivrait le lien ou ouvrirait le client mail au
    // lieu de sélectionner le bloc
    wrapper.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault();
    });
    wrapper.addEventListener('submit', (e) => e.preventDefault());
    wrapper.addEventListener('mousedown', (e) => {
      if (e.target.closest('.resize-handle')) return;
      if (e.shiftKey) {
        e.preventDefault();
        toggleMultiSelect(id);
        return;
      }
      // clic simple sur un bloc déjà dans une sélection multiple : on la
      // préserve pour pouvoir déplacer tout le groupe d'un coup
      if (multiSelectIds.size > 1 && multiSelectIds.has(id)) {
        startMove(e, id, true);
        return;
      }
      clearMultiSelect();
      startMove(e, id);
    });
    wrapper.querySelectorAll('.resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => startResize(e, id, handle.dataset.dir));
    });
    positionOverlays(wrapper);
  });

  updateCanvasHeight();
  ensureSnapGuides();
}

// un bloc "barre latérale" avec un côté choisi se fixe sur ce bord (voir
// renderBlockContent dans blocks.js) : ni déplaçable, ni redimensionnable
// par glisser — se règle uniquement via le panneau de propriétés
function isPinnedBlock(block) {
  return (PINNABLE_SIDES[block.type] || []).includes(block.side);
}

// aligne le cadre de sélection, les poignées et le bouton de suppression sur
// les bords réellement rendus du bloc — mesurés via .blk-resizable plutôt
// que déduits de block.x/y, car un bloc fixé (isPinnedBlock) ignore x/y et
// se positionne uniquement en CSS (top/bottom/gauche ou droite)
function positionOverlays(wrapper) {
  const block = findBlock(wrapper.dataset.id);
  const content = wrapper.querySelector('.blk-resizable');
  if (!block || !content) return;
  const left = content.offsetLeft;
  const top = content.offsetTop;
  const width = content.offsetWidth;
  const height = content.offsetHeight;
  const handles = wrapper.querySelector('.resize-handles');
  const frame = wrapper.querySelector('.selection-frame');
  for (const el of [handles, frame]) {
    if (!el) continue;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
  }
}

// agrandit le canevas pour qu'il contienne toujours tous les blocs, quelle
// que soit leur position (mesuré, pas déduit de block.height qui peut être
// 'auto') — les blocs fixés sont exclus : leur hauteur épouse déjà celle du
// canevas (top:0;bottom:0), les mesurer ferait grandir le canevas sans fin
function updateCanvasHeight() {
  let maxBottom = 400;
  canvasEl.querySelectorAll('.block-wrapper').forEach(w => {
    const block = findBlock(w.dataset.id);
    if (block && isPinnedBlock(block)) return;
    const content = w.querySelector('.blk-resizable');
    if (!content) return;
    maxBottom = Math.max(maxBottom, content.offsetTop + content.offsetHeight + 60);
  });
  canvasEl.style.minHeight = maxBottom + 'px';
}

// glisser le corps d'un bloc le déplace n'importe où sur le canevas ; un
// bloc verrouillé ou fixé sur un bord se sélectionne toujours mais ne peut
// pas être déplacé. isGroup=true (clic sur un bloc déjà dans une sélection
// multiple) déplace tous les blocs sélectionnés ensemble, sans aimantation
// (simplification : l'aimantation ne compare qu'un seul bloc à la fois)
function startMove(e, id, isGroup) {
  const block = findBlock(id);
  if (block.locked || isPinnedBlock(block)) { selectBlock(id); return; }
  e.preventDefault();
  gestureActive = true;
  if (!isGroup) selectBlock(id);

  const ids = isGroup ? [...multiSelectIds] : [id];
  const movable = ids.map(findBlock).filter(b => b && !b.locked && !isPinnedBlock(b));
  const starts = movable.map(b => ({ id: b.id, x: b.x, y: b.y }));
  const startX = e.clientX;
  const startY = e.clientY;

  // l'aimantation ne s'applique qu'au déplacement d'un seul bloc : en groupe,
  // comparer chaque bloc à tous les autres (y compris ceux du même groupe,
  // qui bougent aussi) n'aurait pas de cible stable
  const single = !isGroup && movable.length === 1;
  const wrapper = single ? canvasEl.querySelector(`.block-wrapper[data-id="${id}"]`) : null;
  const content = single ? wrapper.querySelector('.blk-resizable') : null;
  const snapTargets = single ? computeSnapTargets(id) : null;

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    if (single) {
      const candX = Math.max(0, starts[0].x + dx);
      const candY = Math.max(0, starts[0].y + dy);
      const width = block.width || 400;
      const height = content.offsetHeight;

      const xMatch = bestSnapMatch(
        [['left', candX], ['center', candX + width / 2], ['right', candX + width]],
        snapTargets.xs, SNAP_THRESHOLD
      );
      block.x = Math.max(0, xMatch ? candX + (xMatch.target - xMatch.value) : candX);

      const yMatch = bestSnapMatch(
        [['top', candY], ['center', candY + height / 2], ['bottom', candY + height]],
        snapTargets.ys, SNAP_THRESHOLD
      );
      block.y = Math.max(0, yMatch ? candY + (yMatch.target - yMatch.value) : candY);

      content.style.left = block.x + 'px';
      content.style.top = block.y + 'px';
      positionOverlays(wrapper);
      updateSnapGuides(xMatch ? xMatch.target : null, yMatch ? yMatch.target : null);
    } else {
      starts.forEach(s => {
        const b = findBlock(s.id);
        if (!b) return;
        b.x = Math.max(0, s.x + dx);
        b.y = Math.max(0, s.y + dy);
        const w = canvasEl.querySelector(`.block-wrapper[data-id="${s.id}"]`);
        if (!w) return;
        const c = w.querySelector('.blk-resizable');
        if (c) { c.style.left = b.x + 'px'; c.style.top = b.y + 'px'; }
        positionOverlays(w);
      });
    }
    updateCanvasHeight();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('blur', onUp);
    hideSnapGuides();
    gestureActive = false;
    pushHistory();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // si le curseur quitte la fenêtre entièrement, aucun mouseup ne peut plus
  // survenir sur document : sans ce filet, les écouteurs resteraient
  // accrochés indéfiniment et gestureActive bloquerait tous les raccourcis
  window.addEventListener('blur', onUp);
}

// glisser une poignée ajuste width/height (px) depuis n'importe quel côté ;
// gauche/haut déplacent aussi x/y pour garder le bord opposé fixe, comme
// dans un éditeur de design classique
function startResize(e, id, dir) {
  e.preventDefault();
  e.stopPropagation();
  gestureActive = true;
  const block = findBlock(id);
  const wrapper = canvasEl.querySelector(`.block-wrapper[data-id="${id}"]`);
  const content = wrapper.querySelector('.blk-resizable');
  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = block.width || 400;
  const startHeight = block.height || content.getBoundingClientRect().height;
  const startLeft = block.x;
  const startTop = block.y;
  // un seul bord bouge par poignée, pas besoin de comparer gauche/centre/droite
  const snapTargets = computeSnapTargets(id);

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dir === 'right') {
      const rightEdge = startLeft + Math.max(40, Math.round(startWidth + dx));
      const snapped = findSnap(rightEdge, snapTargets.xs, SNAP_THRESHOLD);
      block.width = Math.max(40, (snapped ?? rightEdge) - block.x);
      updateSnapGuides(snapped, null);
    } else if (dir === 'left') {
      const rawLeft = Math.max(0, Math.round(startLeft + dx));
      const snapped = findSnap(rawLeft, snapTargets.xs, SNAP_THRESHOLD);
      const finalLeft = snapped ?? rawLeft;
      block.width = Math.max(40, (startLeft + startWidth) - finalLeft);
      block.x = finalLeft;
      updateSnapGuides(snapped, null);
    } else if (dir === 'bottom') {
      const bottomEdge = startTop + Math.max(20, Math.round(startHeight + dy));
      const snapped = findSnap(bottomEdge, snapTargets.ys, SNAP_THRESHOLD);
      block.height = Math.max(20, (snapped ?? bottomEdge) - block.y);
      updateSnapGuides(null, snapped);
    } else if (dir === 'top') {
      const rawTop = Math.max(0, Math.round(startTop + dy));
      const snapped = findSnap(rawTop, snapTargets.ys, SNAP_THRESHOLD);
      const finalTop = snapped ?? rawTop;
      block.height = Math.max(20, (startTop + startHeight) - finalTop);
      block.y = finalTop;
      updateSnapGuides(null, snapped);
    }
    updateBlockDom(id);
    syncSizeFields(block);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('blur', onUp);
    hideSnapGuides();
    gestureActive = false;
    pushHistory();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  window.addEventListener('blur', onUp);
}

// copie un bloc (tous ses réglages) juste après l'original dans state.blocks
// — pas en fin de tableau, sinon il saute visuellement au-dessus de tous les
// autres blocs (l'ordre du tableau pilote l'empilement, voir bringToFront)
function duplicateBlock(id) {
  const block = findBlock(id);
  if (!block) return;
  const [copy] = cloneBlocks([block]);
  copy.id = makeBlockId();
  copy.x = Math.max(0, block.x + DUPLICATE_OFFSET);
  copy.y = Math.max(0, block.y + DUPLICATE_OFFSET);
  const blocks = getBlocks();
  const idx = blocks.findIndex(b => b.id === id);
  blocks.splice(idx + 1, 0, copy);
  state.selectedId = copy.id;
  pushHistory();
  render();
}

// ---------- Copier / Couper / Coller ----------

function copySelected() {
  if (!state.selectedId) return;
  const block = findBlock(state.selectedId);
  if (!block) return;
  clipboardBlock = cloneBlocks([block])[0];
  pasteCount = 0;
}

function cutSelected() {
  if (!state.selectedId) return;
  copySelected();
  deleteBlock(state.selectedId);
}

// colle le bloc copié, décalé un peu plus à chaque collage successif
// (cascade) plutôt que de toujours superposer la copie au même endroit
function pasteClipboard() {
  if (!clipboardBlock) return;
  pasteCount++;
  const [copy] = cloneBlocks([clipboardBlock]);
  copy.id = makeBlockId();
  copy.x = Math.max(0, clipboardBlock.x + DUPLICATE_OFFSET * pasteCount);
  copy.y = Math.max(0, clipboardBlock.y + DUPLICATE_OFFSET * pasteCount);
  getBlocks().push(copy);
  state.selectedId = copy.id;
  pushHistory();
  render();
}

// dépose d'un bloc depuis la palette, à l'endroit précis du curseur
function handleDrop(e) {
  const newType = e.dataTransfer.getData('text/x-block-type');
  if (!newType) return;
  const rect = canvasEl.getBoundingClientRect();
  const block = createBlock(newType);
  block.x = Math.max(0, Math.round(e.clientX - rect.left - block.width / 2));
  block.y = Math.max(0, Math.round(e.clientY - rect.top - 20));
  getBlocks().push(block);
  state.selectedId = block.id;
  pushHistory();
  render();
}

canvasEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvasEl.classList.add('drag-over');
});
canvasEl.addEventListener('dragleave', (e) => {
  if (e.target === canvasEl) canvasEl.classList.remove('drag-over');
});
canvasEl.addEventListener('drop', (e) => {
  e.preventDefault();
  canvasEl.classList.remove('drag-over');
  handleDrop(e);
});

function selectBlock(id) {
  state.selectedId = id;
  multiSelectIds.clear();
  renderSelectionVisuals();
  const wrapper = id ? canvasEl.querySelector(`.block-wrapper[data-id="${id}"]`) : null;
  if (wrapper) positionOverlays(wrapper);
  renderProps();
}

// ---------- Sélection multiple ----------

function toggleMultiSelect(id) {
  if (multiSelectIds.has(id)) {
    multiSelectIds.delete(id);
    // selectedId ne doit jamais pointer sur un bloc retiré de la sélection
    // (sinon Ctrl+C/X/D agirait silencieusement dessus) — retombe sur un
    // membre restant de la sélection, ou aucun s'il n'en reste plus
    const remaining = [...multiSelectIds];
    state.selectedId = remaining.length ? remaining[remaining.length - 1] : null;
  } else {
    // amorce la sélection multiple avec le bloc déjà sélectionné simplement,
    // pour que le premier Maj+clic ajoute vraiment un 2e bloc à la sélection
    if (multiSelectIds.size === 0 && state.selectedId) multiSelectIds.add(state.selectedId);
    multiSelectIds.add(id);
    state.selectedId = id;
  }
  renderSelectionVisuals();
  renderProps();
}

function clearMultiSelect() {
  if (multiSelectIds.size === 0) return;
  multiSelectIds.clear();
  renderSelectionVisuals();
}

// met à jour les classes .selected/.multi-selected sans reconstruire tout le
// canevas (garderait les écouteurs et l'état d'un éventuel geste en cours)
function renderSelectionVisuals() {
  canvasEl.querySelectorAll('.block-wrapper').forEach(w => {
    const id = w.dataset.id;
    w.classList.toggle('selected', id === state.selectedId && multiSelectIds.size <= 1);
    w.classList.toggle('multi-selected', multiSelectIds.has(id));
  });
  const layersEl = document.getElementById('layersList');
  if (layersEl) {
    layersEl.querySelectorAll('.layer-item').forEach(item => {
      const id = item.dataset.id;
      item.classList.toggle('selected', id === state.selectedId && multiSelectIds.size <= 1);
      item.classList.toggle('multi-selected', multiSelectIds.has(id));
    });
  }
}

// aligne les blocs sélectionnés (>=2) sur un bord/centre de leur boîte
// englobante commune
function alignSelection(edge) {
  const ids = [...multiSelectIds];
  if (ids.length < 2) return;
  const blocksSel = ids.map(findBlock).filter(Boolean);
  const heights = blocksSel.map(b => {
    const w = canvasEl.querySelector(`.block-wrapper[data-id="${b.id}"] .blk-resizable`);
    return w ? w.offsetHeight : 0;
  });
  const lefts = blocksSel.map(b => b.x);
  const rights = blocksSel.map(b => b.x + (b.width || 400));
  const tops = blocksSel.map(b => b.y);
  const bottoms = blocksSel.map((b, i) => tops[i] + heights[i]);
  const minLeft = Math.min(...lefts), maxRight = Math.max(...rights);
  const minTop = Math.min(...tops), maxBottom = Math.max(...bottoms);

  blocksSel.forEach((b, i) => {
    if (edge === 'left') b.x = minLeft;
    else if (edge === 'right') b.x = maxRight - (b.width || 400);
    else if (edge === 'center-h') b.x = Math.round(minLeft + (maxRight - minLeft) / 2 - (b.width || 400) / 2);
    else if (edge === 'top') b.y = minTop;
    else if (edge === 'bottom') b.y = maxBottom - heights[i];
    else if (edge === 'middle') b.y = Math.round(minTop + (maxBottom - minTop) / 2 - heights[i] / 2);
  });
  pushHistory();
  render();
}

// supprime un ou plusieurs blocs d'un coup — deleteBlock(id) reste utilisable
// partout où un seul id est manipulé (bouton ×, Ctrl+X...)
function deleteBlocks(ids) {
  const idSet = new Set(ids);
  setBlocks(getBlocks().filter(b => !idSet.has(b.id)));
  if (idSet.has(state.selectedId)) state.selectedId = null;
  // ne retire que les ids réellement supprimés — un autre bloc actif dans la
  // sélection multiple (non concerné par cette suppression) doit le rester
  idSet.forEach(id => multiSelectIds.delete(id));
  pushHistory();
  render();
}

function deleteBlock(id) {
  deleteBlocks([id]);
}

// remplace uniquement le contenu rendu d'un bloc (garde le panneau de
// propriétés et son focus intacts pendant la frappe)
function updateBlockDom(id) {
  const wrapper = canvasEl.querySelector(`.block-wrapper[data-id="${id}"]`);
  if (!wrapper) return;
  const frame = wrapper.querySelector('.selection-frame');
  const handles = wrapper.querySelector('.resize-handles');
  wrapper.innerHTML = '';
  wrapper.appendChild(frame);
  wrapper.appendChild(handles);
  const blocks = getBlocks();
  const block = findBlock(id);
  wrapper.insertAdjacentHTML('beforeend', renderBlockContent(block, blocks));
  positionOverlays(wrapper);
  updateCanvasHeight();

  // une navbar/footer fixé détermine la hauteur disponible pour une barre
  // latérale fixée (voir computePinOffsets dans blocks.js) : si c'est elle
  // qui vient de changer (hauteur, côté...), rafraîchir aussi la barre
  // latérale, sinon elle resterait affichée à une taille périmée jusqu'au
  // prochain rendu complet
  if (block && (block.type === 'navbar' || block.type === 'footer')) {
    blocks.forEach(b => {
      if (b.id !== id && b.type === 'sidebar' && b.side && b.side !== 'none') updateBlockDom(b.id);
    });
  }
}

// ---------- Panneau de propriétés ----------

// navigation par onglets (Contenu / Apparence / Taille & ordre), inspirée
// des inspecteurs Blender/Unity : un seul groupe de champs affiché à la
// fois plutôt qu'un accordéon. L'onglet actif est un état de navigation
// (comme rester sur l'onglet Material en cliquant d'un objet à l'autre dans
// Blender), pas une préférence — jamais persisté entre rechargements
let activePropTab = 'Contenu';
// filtre de recherche du panneau Propriétés (bandeau du haut, façon Blender) :
// masque les champs du seul onglet actif dont le libellé ne correspond pas —
// pas d'index global multi-onglets, ça resterait cohérent avec la navigation
// par onglets plutôt que de la court-circuiter
let propsSearchQuery = '';
const PROP_TABS = [
  { name: 'Contenu', icon: '✎' },
  { name: 'Apparence', icon: '◐' },
  { name: 'Taille & ordre', icon: '↔' },
];

// registre des types de champ "simples" : chacun sait rendre son contrôle et
// lire sa valeur depuis le DOM. Les couleurs (renderColorField/bindColorField)
// et les cases seules (rendu en ligne dans renderSchemaField) suivent leur
// propre chemin, trop différents pour entrer dans ce moule
const FIELD_KINDS = {
  text: {
    continuous: true,
    control: (field, value) => `<input type="text" id="prop-${field.key}" value="${escapeHtml(value)}">`,
    read: (input, field) => {
      if (!field.numeric) return input.value;
      const n = Number(input.value);
      return Number.isNaN(n) ? undefined : n; // saisie non numérique : ignorée, valeur précédente conservée
    },
  },
  textarea: {
    continuous: true,
    control: (field, value) => `<textarea id="prop-${field.key}">${escapeHtml(value)}</textarea>`,
    read: (input) => input.value,
  },
  'list-items': {
    continuous: true,
    control: (field, value) => `<textarea id="prop-${field.key}" placeholder="Un élément par ligne">${escapeHtml(value.join('\n'))}</textarea>`,
    read: (input) => input.value.split('\n').map(s => s.trim()).filter(Boolean),
  },
  'qa-items': {
    continuous: true,
    control: (field, value) => `<textarea id="prop-${field.key}" placeholder="Question | Réponse">${escapeHtml(value.map(i => `${i.q} | ${i.a}`).join('\n'))}</textarea>`,
    // "Question | Réponse" par ligne — le texte après le premier "|" est
    // repris tel quel (join) pour tolérer une réponse contenant elle-même "|"
    read: (input) => input.value.split('\n').map(line => {
      const [q, ...rest] = line.split('|');
      return { q: (q || '').trim(), a: rest.join('|').trim() };
    }).filter(item => item.q || item.a),
  },
  select: {
    continuous: false,
    control: (field, value) => `<select id="prop-${field.key}">${field.options.map(([v, l]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`,
    read: (input, field) => {
      if (!field.numeric) return input.value;
      const n = Number(input.value);
      return Number.isNaN(n) ? undefined : n;
    },
  },
  checkbox: {
    continuous: false,
    read: (input) => input.checked,
  },
};

// rend un champ propre à un type de bloc (PROP_SCHEMAS) : couleur et case à
// cocher ont leur propre présentation, tout le reste passe par FIELD_KINDS
function renderSchemaField(field, value) {
  if (field.type === 'checkbox') {
    return `<label class="prop-checkbox"><input type="checkbox" id="prop-${field.key}"${value ? ' checked' : ''}> ${escapeHtml(field.label)}</label>`;
  }
  if (field.type === 'color') {
    return renderColorField(field.key, field.label, value, { optional: false });
  }
  const kind = FIELD_KINDS[field.type] || FIELD_KINDS.text;
  return `<div class="prop-field"><label for="prop-${field.key}">${escapeHtml(field.label)}</label>${kind.control(field, value)}</div>`;
}

// écoute une saisie continue (texte/nombre/liste...) sur "input" et ne pousse
// l'historique qu'au blur — une frappe = un caractère, pas une entrée
// d'historique ; une saisie discrète (select/checkbox) pousse immédiatement
// au "change". Seul point qui décide de ce choix, réutilisé par tous les
// champs simples (propres au bloc + Apparence/Taille communs). Chaque champ
// est lié indépendamment (élément absent ou erreur ponctuelle n'affectent
// que lui) pour qu'un seul champ défaillant ne bloque jamais les autres.
// resetValue : valeur à réappliquer en cliquant le bouton "×" (chaîne vide
// par défaut = "auto"/"thème" ; ex. "none" pour le <select> Ombre)
function bindField({ id, continuous, read, onCommit, resetBtnId, resetValue = '' }) {
  const input = document.getElementById(id);
  if (!input) { console.error(`champ introuvable : ${id}`); return; }
  input.addEventListener(continuous ? 'input' : 'change', () => {
    try {
      const value = read(input);
      if (value === undefined) return; // saisie invalide : ignorée silencieusement
      onCommit(value);
      if (!continuous) pushHistory();
    } catch (err) {
      console.error(`échec de mise à jour du champ ${id} :`, err);
    }
  });
  if (continuous) input.addEventListener('blur', () => pushHistory());
  if (resetBtnId) {
    const resetBtn = document.getElementById(resetBtnId);
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        input.value = resetValue;
        onCommit(read(input));
        pushHistory();
        renderProps();
      });
    } else {
      console.error(`bouton de réinitialisation introuvable : ${resetBtnId}`);
    }
  }
}

function commitFieldValue(block, key, value) {
  block[key] = value;
  // "side" change le comportement du wrapper lui-même (classe .pinned,
  // poignées masquées) — updateBlockDom ne touche que le contenu intérieur,
  // il faut un render() complet pour que ça se répercute
  if (key === 'side') render(); else updateBlockDom(block.id);
}

// glisser horizontalement sur le libellé d'un champ numérique change sa
// valeur, comme dans Blender/Unity (cliquer-glisser sur le nom du champ
// plutôt que devoir cliquer dans le champ puis taper) — un simple clic sans
// mouvement significatif garde le comportement natif du <label> (focus du
// champ associé) ; Maj+glisser = pas fin (x0.1), comme les deux outils
function makeLabelScrubbable(label, input, { step = 1, min, max } = {}) {
  if (!label || !input) return;
  label.classList.add('prop-label-scrub');
  label.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startValue = Number(input.value) || 0;
    let dragging = false;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) > 3) {
        dragging = true;
        label.classList.add('scrubbing');
      }
      if (!dragging) return;
      const speed = ev.shiftKey ? step * 0.1 : step;
      let next = startValue + dx * speed;
      if (min != null) next = Math.max(min, next);
      if (max != null) next = Math.min(max, next);
      input.value = Math.round(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      label.classList.remove('scrubbing');
      // le glisser vaut une saisie complète : une seule entrée d'historique,
      // comme le blur qui suit normalement une frappe au clavier
      if (dragging) input.dispatchEvent(new Event('blur'));
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// sélecteur natif <input type=color> + champ hexadécimal, synchronisés dans
// les deux sens ; en mode optionnel (section Apparence), une case "Activer"
// pilote si block[key] vaut null (pas de surcharge) ou la couleur choisie
function renderColorField(key, label, value, { optional }) {
  const enabled = !optional || value != null;
  const displayValue = value || '#000000';
  const checkboxHtml = optional ? `<input type="checkbox" id="prop-${key}-enabled"${enabled ? ' checked' : ''}>` : '';
  return `
    <div class="prop-field">
      <label for="prop-${key}${optional ? '-enabled' : ''}">${escapeHtml(label)}</label>
      <div class="prop-color-row">
        ${checkboxHtml}
        <input type="color" id="prop-${key}" value="${displayValue}"${enabled ? '' : ' disabled'}>
        <input type="text" id="prop-${key}-hex" class="prop-color-hex" value="${enabled ? escapeHtml(displayValue) : ''}" placeholder="#000000" maxlength="7"${enabled ? '' : ' disabled'}>
      </div>
    </div>
  `;
}

// blocks est toujours un tableau — un seul élément en édition simple,
// plusieurs en édition groupée (sélection multiple), même chemin pour les
// deux (voir bindAppearanceFields)
function bindColorField(blocks, key, { optional }) {
  const colorInput = document.getElementById(`prop-${key}`);
  const hexInput = document.getElementById(`prop-${key}-hex`);
  const checkbox = optional ? document.getElementById(`prop-${key}-enabled`) : null;
  if (!colorInput || !hexInput || (optional && !checkbox)) { console.error(`champ couleur introuvable : ${key}`); return; }
  const isActive = () => !optional || checkbox.checked;
  const applyToAll = (value) => {
    blocks.forEach(b => { b[key] = value; });
    blocks.forEach(b => updateBlockDom(b.id));
  };
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      colorInput.disabled = !checkbox.checked;
      hexInput.disabled = !checkbox.checked;
      hexInput.value = checkbox.checked ? colorInput.value : '';
      applyToAll(checkbox.checked ? colorInput.value : null);
      pushHistory();
    });
  }
  colorInput.addEventListener('input', () => {
    if (!isActive()) return;
    hexInput.value = colorInput.value;
    applyToAll(colorInput.value);
  });
  colorInput.addEventListener('blur', () => pushHistory());
  hexInput.addEventListener('input', () => {
    if (!isActive()) return;
    const v = hexInput.value.trim();
    if (!HEX_COLOR_RE.test(v)) return; // saisie incomplète en cours de frappe : on ignore silencieusement
    const expanded = expandHexColor(v);
    colorInput.value = expanded;
    applyToAll(expanded);
  });
  hexInput.addEventListener('blur', () => pushHistory());
}

// panneau affiché quand plusieurs blocs sont sélectionnés (Maj+clic) :
// alignement de groupe + édition groupée de l'Apparence (s'applique à tous
// les blocs sélectionnés à la fois — édition multi-objets façon Blender/
// Unity) + suppression. Les champs propres au type (Contenu) et Taille
// restent en édition individuelle uniquement : trop de blocs de types
// différents pour qu'un champ commun ait un sens
function renderMultiSelectProps() {
  propsPanelEl.className = '';
  const blocks = [...multiSelectIds].map(findBlock).filter(Boolean);
  const ref = blocks[0];
  if (!ref) return;

  propsPanelEl.innerHTML = `
    <div class="prop-section-title prop-section-title-first">${multiSelectIds.size} blocs sélectionnés</div>
    <div class="prop-field-row">
      <button type="button" class="sb-btn" id="alignLeftBtn" title="Aligner à gauche">◧</button>
      <button type="button" class="sb-btn" id="alignCenterHBtn" title="Centrer horizontalement">◫</button>
      <button type="button" class="sb-btn" id="alignRightBtn" title="Aligner à droite">◨</button>
    </div>
    <div class="prop-field-row">
      <button type="button" class="sb-btn" id="alignTopBtn" title="Aligner en haut">⬒</button>
      <button type="button" class="sb-btn" id="alignMiddleBtn" title="Centrer verticalement">▤</button>
      <button type="button" class="sb-btn" id="alignBottomBtn" title="Aligner en bas">⬓</button>
    </div>
    <div class="prop-section-title">Apparence (tous les blocs)</div>
    ${renderAppearanceFields(ref)}
    <button type="button" class="prop-delete-btn" id="propsDeleteSelectionBtn">Supprimer la sélection</button>
  `;
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
    else console.error(`élément introuvable : ${id}`);
  };
  bind('alignLeftBtn', () => alignSelection('left'));
  bind('alignCenterHBtn', () => alignSelection('center-h'));
  bind('alignRightBtn', () => alignSelection('right'));
  bind('alignTopBtn', () => alignSelection('top'));
  bind('alignMiddleBtn', () => alignSelection('middle'));
  bind('alignBottomBtn', () => alignSelection('bottom'));
  bind('propsDeleteSelectionBtn', () => deleteBlocks([...multiSelectIds]));

  bindAppearanceFields(blocks);
}

// en-tête d'identification (icône + type + aperçu du contenu) : le panneau
// se limitait avant à une liste de champs sans jamais rappeler quel bloc on
// est en train d'éditer
function blockSummaryText(block) {
  const text = block.text || block.title || block.brand;
  return text ? String(text).slice(0, 40) : '';
}

// deux lignes façon Blender : un fil d'Ariane discret (icône + type, comme
// "Cube" au-dessus du champ de nom), puis une ligne façon champ de nom (fond
// distinct + icône carrée colorée) montrant un aperçu du contenu du bloc
function renderPropsHeader(block, def) {
  const summary = blockSummaryText(block);
  return `
    <div class="props-breadcrumb">
      <span class="props-breadcrumb-icon">${escapeHtml(def.icon)}</span>
      <span class="props-breadcrumb-label">${escapeHtml(def.label)}</span>
    </div>
    <div class="props-name-row">
      <span class="props-name-icon">${escapeHtml(def.icon)}</span>
      <span class="props-name-text">${escapeHtml(summary || def.label)}</span>
    </div>
  `;
}

// bande d'onglets verticale, icônes seules — reproduit la colonne de gauche
// de l'éditeur de propriétés Blender (Objet/Modificateurs/Matériau...) : un
// seul groupe de champs affiché à la fois plutôt qu'un accordéon unique
function renderPropTabs() {
  return `
    <div class="prop-tabs-v" role="tablist">
      ${PROP_TABS.map(t => `
        <button type="button" class="prop-tab-v${activePropTab === t.name ? ' active' : ''}" data-tab="${escapeHtml(t.name)}" role="tab" aria-selected="${activePropTab === t.name}" title="${escapeHtml(t.name)}">
          <span class="prop-tab-icon">${escapeHtml(t.icon)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function bindPropTabs() {
  propsPanelEl.querySelectorAll('.prop-tab-v').forEach(tab => {
    tab.addEventListener('click', () => {
      activePropTab = tab.dataset.tab;
      renderProps();
    });
  });
}

// bandeau de recherche en tête du panneau (voir la barre de recherche de
// l'éditeur de propriétés Blender) — filtre les champs de l'onglet actif
// par libellé, en dépliant au passage les sous-groupes Apparence concernés
// pour qu'un résultat ne reste jamais caché derrière un chevron fermé
function renderPropsSearchBar() {
  return `
    <div class="prop-search-row">
      <input type="search" id="propsSearch" class="sb-input" placeholder="Rechercher un champ…" value="${escapeHtml(propsSearchQuery)}">
    </div>
  `;
}

function bindPropsSearchBar() {
  const input = document.getElementById('propsSearch');
  if (!input) { console.error('élément introuvable : propsSearch'); return; }
  input.addEventListener('input', () => {
    propsSearchQuery = input.value;
    applyPropsSearchFilter();
  });
}

function applyPropsSearchFilter() {
  const panel = propsPanelEl.querySelector('.prop-tab-panel');
  if (!panel) return;
  const query = propsSearchQuery.trim().toLowerCase();

  const units = panel.querySelectorAll('.prop-field, .prop-checkbox');
  units.forEach(unit => {
    const label = unit.querySelector('label') || unit; // .prop-checkbox est lui-même le label
    const match = !query || (label.textContent || '').toLowerCase().includes(query);
    unit.style.display = match ? '' : 'none';
  });

  // masque un sous-groupe Apparence entier si aucun de ses champs ne
  // correspond, et déplie les groupes qui contiennent un résultat
  panel.querySelectorAll('.prop-row-group').forEach(group => {
    const groupUnits = [...group.querySelectorAll('.prop-field, .prop-checkbox')];
    const anyMatch = groupUnits.some(u => u.style.display !== 'none');
    group.style.display = (!query || anyMatch) ? '' : 'none';
    if (query && anyMatch) {
      group.querySelector('.prop-row-body').classList.remove('collapsed');
      const arrow = group.querySelector('.prop-row-arrow');
      if (arrow) arrow.classList.add('expanded');
    }
  });

  let emptyMsg = panel.querySelector('.prop-search-empty');
  const anyVisible = [...units].some(u => u.style.display !== 'none');
  if (query && !anyVisible) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('p');
      emptyMsg.className = 'prop-search-empty';
      emptyMsg.textContent = 'Aucun champ trouvé dans cet onglet.';
      panel.appendChild(emptyMsg);
    }
  } else if (emptyMsg) {
    emptyMsg.remove();
  }
}

function renderProps() {
  if (multiSelectIds.size > 1) { renderMultiSelectProps(); return; }

  const block = findBlock(state.selectedId);
  if (!block) {
    propsPanelEl.className = 'sb-props-empty';
    propsPanelEl.textContent = 'Sélectionnez un bloc pour modifier ses propriétés.';
    return;
  }
  propsPanelEl.className = '';

  const schema = PROP_SCHEMAS[block.type];
  const def = BLOCK_DEFS[block.type];
  const tabContent = {
    'Contenu': schema.map(field => renderSchemaField(field, block[field.key])).join(''),
    'Apparence': renderAppearanceFields(block),
    'Taille & ordre': renderSizeFields(block),
  };

  propsPanelEl.innerHTML = renderPropsSearchBar() + `
    <div class="props-layout">
      ${renderPropTabs()}
      <div class="prop-panel-body">
        ${renderPropsHeader(block, def)}
        <div class="prop-tab-panel">${tabContent[activePropTab] || tabContent['Contenu']}</div>
        ${renderPropsActions()}
      </div>
    </div>
  `;

  bindPropsSearchBar();
  bindPropTabs();

  if (activePropTab === 'Apparence') {
    bindAppearanceFields([block]);
  } else if (activePropTab === 'Taille & ordre') {
    bindField({
      id: 'prop-width', continuous: true,
      read: (input) => Math.max(40, Number(input.value) || 400),
      onCommit: (value) => { block.width = value; updateBlockDom(block.id); },
    });
    bindField({
      id: 'prop-height', continuous: true,
      read: (input) => input.value ? Math.max(20, Number(input.value)) : null,
      onCommit: (value) => { block.height = value; updateBlockDom(block.id); },
      resetBtnId: 'prop-height-reset',
    });
    bindField({
      id: 'prop-locked', continuous: false,
      read: (input) => input.checked,
      onCommit: (value) => { block.locked = value; render(); },
    });
    makeLabelScrubbable(document.querySelector('label[for="prop-width"]'), document.getElementById('prop-width'), { step: 1, min: 40 });
    makeLabelScrubbable(document.querySelector('label[for="prop-height"]'), document.getElementById('prop-height'), { step: 1, min: 20 });
  } else {
    schema.forEach(field => {
      if (field.type === 'color') { bindColorField([block], field.key, { optional: false }); return; }
      const kind = FIELD_KINDS[field.type] || FIELD_KINDS.text;
      bindField({
        id: `prop-${field.key}`,
        continuous: kind.continuous,
        read: (input) => kind.read(input, field),
        onCommit: (value) => commitFieldValue(block, field.key, value),
      });
    });
  }

  bindPropsActions(block);
  applyPropsSearchFilter();
}

// sous-groupes repliables façon Blender (une liste de lignes à chevron —
// Transform/Relations/Collections... dans l'onglet Objet) : état de repli
// en mémoire, par session seulement, pas persisté entre rechargements
const propRowGroupsCollapsed = new Set();

function renderPropRowGroup(name, innerHtml) {
  const collapsed = propRowGroupsCollapsed.has(name);
  return `
    <div class="prop-row-group">
      <button type="button" class="prop-row-header" data-row-group="${escapeHtml(name)}" aria-expanded="${!collapsed}">
        <span class="prop-row-arrow${collapsed ? '' : ' expanded'}">▸</span>
        <span class="prop-row-label">${escapeHtml(name)}</span>
      </button>
      <div class="prop-row-body${collapsed ? ' collapsed' : ''}">${innerHtml}</div>
    </div>
  `;
}

// rafraîchit le panneau adapté au mode courant — les groupes repliables
// étant partagés entre édition simple et groupée, leur clic doit rappeler
// le bon renderer selon qu'on est en sélection multiple ou non
function rerenderProps() {
  if (multiSelectIds.size > 1) renderMultiSelectProps(); else renderProps();
}

function bindPropRowGroups() {
  propsPanelEl.querySelectorAll('.prop-row-header').forEach(header => {
    header.addEventListener('click', () => {
      const name = header.dataset.rowGroup;
      if (propRowGroupsCollapsed.has(name)) propRowGroupsCollapsed.delete(name); else propRowGroupsCollapsed.add(name);
      rerenderProps();
    });
  });
}

// section Apparence : rendu et liaison communs à l'édition simple (un bloc)
// et groupée (plusieurs blocs sélectionnés) — "ref" ne préremplit que
// l'affichage initial, la liaison (bindAppearanceFields) s'applique ensuite
// à tous les blocs passés. Un point (.prop-modified-dot) + bouton "×"
// apparaissent sur tout champ qui s'écarte de sa valeur par défaut, comme
// les champs modifiés dans Unity ; les deux sous-groupes (Couleurs/Effets)
// reprennent le style "liste de lignes à chevron" des sous-panneaux Blender
function renderAppearanceFields(ref) {
  const radiusModified = ref.radius != null;
  const opacityModified = ref.opacity != null && ref.opacity !== 100;
  const shadowModified = (ref.shadow || 'none') !== 'none';
  const dot = '<span class="prop-modified-dot"></span>';

  const colorsHtml = `
    ${renderColorField('bgColor', 'Fond', ref.bgColor, { optional: true })}
    ${renderColorField('textColor', 'Texte', ref.textColor, { optional: true })}
    ${renderColorField('borderColor', 'Bordure', ref.borderColor, { optional: true })}
  `;

  const effectsHtml = `
    <div class="prop-field-row">
      <div class="prop-field">
        <label for="prop-radius" class="${radiusModified ? 'is-modified' : ''}">${radiusModified ? dot : ''}Rayon (px)</label>
        <div class="prop-input-with-reset">
          <input type="number" id="prop-radius" min="0" placeholder="thème" value="${ref.radius ?? ''}">
          <button type="button" class="prop-reset-btn" id="prop-radius-reset" title="Revenir au style du thème"${radiusModified ? '' : ' hidden'}>×</button>
        </div>
      </div>
      <div class="prop-field">
        <label for="prop-opacity" class="${opacityModified ? 'is-modified' : ''}">${opacityModified ? dot : ''}Opacité (%)</label>
        <div class="prop-input-with-reset">
          <input type="number" id="prop-opacity" min="0" max="100" value="${ref.opacity ?? 100}">
          <button type="button" class="prop-reset-btn" id="prop-opacity-reset" title="Revenir à 100%"${opacityModified ? '' : ' hidden'}>×</button>
        </div>
      </div>
    </div>
    <div class="prop-field">
      <label for="prop-shadow" class="${shadowModified ? 'is-modified' : ''}">${shadowModified ? dot : ''}Ombre</label>
      <div class="prop-input-with-reset">
        <select id="prop-shadow">
          ${Object.keys(SHADOW_LABELS).map(s => `<option value="${s}"${(ref.shadow || 'none') === s ? ' selected' : ''}>${escapeHtml(SHADOW_LABELS[s])}</option>`).join('')}
        </select>
        <button type="button" class="prop-reset-btn" id="prop-shadow-reset" title="Revenir à Aucune"${shadowModified ? '' : ' hidden'}>×</button>
      </div>
    </div>
  `;

  return renderPropRowGroup('Couleurs', colorsHtml) + renderPropRowGroup('Effets', effectsHtml);
}

// blocks est toujours un tableau (voir bindColorField) : un seul élément en
// édition simple (onglet Apparence), plusieurs en édition groupée
// (panneau multi-sélection) — un seul chemin de liaison pour les deux
function bindAppearanceFields(blocks) {
  bindColorField(blocks, 'bgColor', { optional: true });
  bindColorField(blocks, 'textColor', { optional: true });
  bindColorField(blocks, 'borderColor', { optional: true });
  bindField({
    id: 'prop-radius', continuous: true,
    read: (input) => input.value === '' ? null : Math.max(0, Number(input.value) || 0),
    onCommit: (value) => blocks.forEach(b => { b.radius = value; updateBlockDom(b.id); }),
    resetBtnId: 'prop-radius-reset',
  });
  bindField({
    id: 'prop-opacity', continuous: true,
    read: (input) => input.value === '' ? 100 : Math.min(100, Math.max(0, Number(input.value) || 0)),
    onCommit: (value) => blocks.forEach(b => { b.opacity = value; updateBlockDom(b.id); }),
    resetBtnId: 'prop-opacity-reset',
  });
  bindField({
    id: 'prop-shadow', continuous: false,
    read: (input) => input.value,
    onCommit: (value) => blocks.forEach(b => { b.shadow = value; updateBlockDom(b.id); }),
    resetBtnId: 'prop-shadow-reset',
    resetValue: 'none',
  });
  makeLabelScrubbable(document.querySelector('label[for="prop-radius"]'), document.getElementById('prop-radius'), { step: 1, min: 0 });
  makeLabelScrubbable(document.querySelector('label[for="prop-opacity"]'), document.getElementById('prop-opacity'), { step: 1, min: 0, max: 100 });
  bindPropRowGroups();
}

// même barre Largeur/Hauteur/Verrouillé commune à tous les blocs, indépendamment
// de leur type — les actions (dupliquer/ordre/supprimer) vivent dans
// renderPropsActions, toujours visibles sous les onglets
function renderSizeFields(block) {
  const heightModified = block.height != null;
  return `
    <div class="prop-field-row">
      <div class="prop-field"><label for="prop-width">Largeur (px)</label><input type="number" id="prop-width" min="40" value="${block.width || 400}"></div>
      <div class="prop-field">
        <label for="prop-height" class="${heightModified ? 'is-modified' : ''}">${heightModified ? '<span class="prop-modified-dot"></span>' : ''}Hauteur (px)</label>
        <div class="prop-input-with-reset">
          <input type="number" id="prop-height" min="20" placeholder="auto" value="${block.height || ''}">
          <button type="button" class="prop-reset-btn" id="prop-height-reset" title="Revenir à la hauteur automatique"${heightModified ? '' : ' hidden'}>×</button>
        </div>
      </div>
    </div>
    <label class="prop-checkbox"><input type="checkbox" id="prop-locked"${block.locked ? ' checked' : ''}> Verrouillé (position et taille figées)</label>
  `;
}

// actions de bloc (dupliquer, ordre d'empilement, supprimer) regroupées en
// bas du panneau, en dehors des sections repliables — toujours visibles
function renderPropsActions() {
  return `
    <div class="prop-actions">
      <button type="button" class="sb-btn" id="propsDuplicateBtn">⧉ Dupliquer</button>
      <div class="prop-field-row">
        <button type="button" class="sb-btn" id="propsFrontBtn">Premier plan</button>
        <button type="button" class="sb-btn" id="propsBackBtn">Arrière-plan</button>
      </div>
      <button type="button" class="prop-delete-btn" id="propsDeleteBtn">Supprimer ce bloc</button>
    </div>
  `;
}

function bindPropsActions(block) {
  const dupBtn = document.getElementById('propsDuplicateBtn');
  if (dupBtn) dupBtn.addEventListener('click', () => duplicateBlock(block.id));
  else console.error('élément introuvable : propsDuplicateBtn');
  const frontBtn = document.getElementById('propsFrontBtn');
  if (frontBtn) frontBtn.addEventListener('click', () => bringToFront(block.id));
  else console.error('élément introuvable : propsFrontBtn');
  const backBtn = document.getElementById('propsBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => sendToBack(block.id));
  else console.error('élément introuvable : propsBackBtn');
  const deleteBtn = document.getElementById('propsDeleteBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteBlock(block.id));
  else console.error('élément introuvable : propsDeleteBtn');
}

// déplace le bloc en fin/début de state.blocks — l'ordre du tableau pilote
// l'ordre de rendu, donc l'empilement visuel des blocs qui se chevauchent
// (pas de z-index à gérer séparément)
function bringToFront(id) {
  const blocks = getBlocks();
  const idx = blocks.findIndex(b => b.id === id);
  if (idx === -1) return;
  const [block] = blocks.splice(idx, 1);
  blocks.push(block);
  pushHistory();
  render();
}

function sendToBack(id) {
  const blocks = getBlocks();
  const idx = blocks.findIndex(b => b.id === id);
  if (idx === -1) return;
  const [block] = blocks.splice(idx, 1);
  blocks.unshift(block);
  pushHistory();
  render();
}

// garde les champs Largeur/Hauteur à jour pendant un glisser de poignée,
// sans reconstruire tout le panneau (perdrait le focus/la frappe en cours)
function syncSizeFields(block) {
  const widthInput = document.getElementById('prop-width');
  const heightInput = document.getElementById('prop-height');
  if (widthInput) widthInput.value = block.width || 400;
  if (heightInput) heightInput.value = block.height || '';
}


// ---------- Historique (annuler/rétablir) ----------

function snapshot() {
  return { blocks: cloneBlocks(getBlocks()), selectedId: state.selectedId };
}

function initHistory() {
  historyStack = [snapshot()];
  historyIndex = 0;
  updateHistoryButtons();
}

// ajoute l'état courant comme nouvelle entrée d'historique — appelé une
// seule fois par action terminée (jamais depuis un mousemove/keydown répété,
// voir startMove/startResize/onGlobalKeyup)
function pushHistory() {
  if (restoringHistory) return;
  const entry = snapshot();
  const last = historyStack[historyIndex];
  // déduplique sur le contenu des blocs (pas selectedId) : un simple clic de
  // sélection sans déplacement ne doit jamais créer d'entrée
  if (last && JSON.stringify(last.blocks) === JSON.stringify(entry.blocks)) return;
  historyStack.length = historyIndex + 1; // efface la branche "refaire"
  historyStack.push(entry);
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
  historyIndex = historyStack.length - 1;
  updateHistoryButtons();
}

function applyHistorySnapshot(entry) {
  restoringHistory = true;
  setBlocks(cloneBlocks(entry.blocks));
  state.selectedId = entry.selectedId;
  render();
  restoringHistory = false;
  updateHistoryButtons();
}

// gestureActive vérifié ici (pas seulement dans onGlobalKeydown) pour couvrir
// aussi les boutons ↶/↷ : sans ça, un Entrée/Espace sur le bouton Annuler
// pendant un glisser remplacerait le DOM sous les écouteurs mousemove actifs
function undo() {
  if (gestureActive || historyIndex <= 0) return;
  historyIndex--;
  applyHistorySnapshot(historyStack[historyIndex]);
}

function redo() {
  if (gestureActive || historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  applyHistorySnapshot(historyStack[historyIndex]);
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

const undoBtnEl = document.getElementById('undoBtn');
if (undoBtnEl) undoBtnEl.addEventListener('click', undo);
else console.error('élément introuvable : undoBtn');
const redoBtnEl = document.getElementById('redoBtn');
if (redoBtnEl) redoBtnEl.addEventListener('click', redo);
else console.error('élément introuvable : redoBtn');

// ---------- Guides d'alignement / aimantation ----------

// re-crées/ré-attachées à chaque renderCanvas() : celui-ci fait
// canvasEl.innerHTML = ..., ce qui détruirait des guides ajoutées une seule
// fois au démarrage — jamais présentes dans les blocs de la page, donc
// jamais dans l'export (qui ne lit que getBlocks())
function ensureSnapGuides() {
  let v = document.getElementById('snapGuideV');
  let h = document.getElementById('snapGuideH');
  if (!v) { v = document.createElement('div'); v.id = 'snapGuideV'; v.className = 'snap-guide snap-guide-v'; }
  if (!h) { h = document.createElement('div'); h.id = 'snapGuideH'; h.className = 'snap-guide snap-guide-h'; }
  canvasEl.appendChild(v);
  canvasEl.appendChild(h);
}

function updateSnapGuides(guideX, guideY) {
  const v = document.getElementById('snapGuideV');
  const h = document.getElementById('snapGuideH');
  if (v) { if (guideX != null) { v.style.left = guideX + 'px'; v.style.display = 'block'; } else v.style.display = 'none'; }
  if (h) { if (guideY != null) { h.style.top = guideY + 'px'; h.style.display = 'block'; } else h.style.display = 'none'; }
}

function hideSnapGuides() {
  updateSnapGuides(null, null);
}

// bords/centres de tous les autres blocs + bords/centre du canevas — calculé
// une seule fois au début d'un geste (mousedown), pas à chaque mousemove,
// puisque seul le bloc déplacé/redimensionné bouge pendant son propre geste
function computeSnapTargets(excludeId) {
  const xs = new Set([0, canvasEl.clientWidth, canvasEl.clientWidth / 2]);
  const ys = new Set([0]);
  canvasEl.querySelectorAll('.block-wrapper').forEach(w => {
    if (w.dataset.id === excludeId) return;
    const b = findBlock(w.dataset.id);
    const content = w.querySelector('.blk-resizable');
    if (!b || !content) return;
    const width = b.width || 400;
    const height = content.offsetHeight;
    xs.add(b.x); xs.add(b.x + width); xs.add(b.x + width / 2);
    ys.add(b.y); ys.add(b.y + height); ys.add(b.y + height / 2);
  });
  return { xs: [...xs], ys: [...ys] };
}

function findSnap(value, targets, threshold) {
  let best = null, bestDist = threshold;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= bestDist) { bestDist = d; best = t; }
  }
  return best;
}

// parmi plusieurs bords candidats (gauche/centre/droite ou haut/centre/bas),
// ne retient que le plus proche d'une cible — jamais plusieurs à la fois
function bestSnapMatch(candidates, targets, threshold) {
  let best = null;
  for (const [label, value] of candidates) {
    const t = findSnap(value, targets, threshold);
    if (t == null) continue;
    const dist = Math.abs(value - t);
    if (!best || dist < best.dist) best = { label, value, target: t, dist };
  }
  return best;
}

// ---------- Raccourcis clavier ----------

function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// remet à jour la position DOM d'un bloc + ses survols (cadre/poignées) +
// la hauteur du canevas — partagé entre startMove.onMove et le nudge clavier
function syncBlockPositionDom(wrapper, block) {
  const content = wrapper.querySelector('.blk-resizable');
  if (content) {
    content.style.left = block.x + 'px';
    content.style.top = block.y + 'px';
  }
  positionOverlays(wrapper);
  updateCanvasHeight();
}

function onGlobalKeydown(e) {
  if (gestureActive) return;
  const ctrlOrCmd = e.ctrlKey || e.metaKey;

  if (ctrlOrCmd && (e.key === 'z' || e.key === 'Z')) {
    if (isTypingInField()) return; // laisse le undo natif du navigateur agir dans le champ
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (ctrlOrCmd && (e.key === 'y' || e.key === 'Y')) {
    if (isTypingInField()) return;
    e.preventDefault();
    redo();
    return;
  }
  if (ctrlOrCmd && (e.key === 'c' || e.key === 'C')) {
    if (isTypingInField()) return; // laisse le copier natif du navigateur agir dans le champ
    if (state.selectedId) { e.preventDefault(); copySelected(); }
    return;
  }
  if (ctrlOrCmd && (e.key === 'x' || e.key === 'X')) {
    if (isTypingInField()) return;
    if (state.selectedId) { e.preventDefault(); cutSelected(); }
    return;
  }
  if (ctrlOrCmd && (e.key === 'v' || e.key === 'V')) {
    if (isTypingInField()) return; // laisse le coller natif du navigateur agir dans le champ
    if (clipboardBlock) { e.preventDefault(); pasteClipboard(); }
    return;
  }
  if (ctrlOrCmd && (e.key === 'd' || e.key === 'D')) {
    if (isTypingInField()) return;
    if (state.selectedId) { e.preventDefault(); duplicateBlock(state.selectedId); }
    return;
  }

  if (isTypingInField()) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (multiSelectIds.size > 1) { e.preventDefault(); deleteBlocks([...multiSelectIds]); return; }
    if (state.selectedId) { e.preventDefault(); deleteBlock(state.selectedId); }
    return;
  }
  if (e.key === 'Escape') {
    const panel = document.getElementById('shortcutsPanel');
    if (panel && !panel.hidden) { toggleShortcutsPanel(false); return; }
    if (multiSelectIds.size > 0) { clearMultiSelect(); renderProps(); return; }
    if (state.selectedId) selectBlock(null);
    return;
  }
  if (e.key.startsWith('Arrow')) {
    if (!state.selectedId) return;
    const block = findBlock(state.selectedId);
    if (!block || block.locked) return; // cohérent avec startMove qui refuse de déplacer un bloc verrouillé
    e.preventDefault();
    const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
    if (e.key === 'ArrowLeft') block.x = Math.max(0, block.x - step);
    else if (e.key === 'ArrowRight') block.x = Math.max(0, block.x + step);
    else if (e.key === 'ArrowUp') block.y = Math.max(0, block.y - step);
    else if (e.key === 'ArrowDown') block.y = Math.max(0, block.y + step);
    const wrapper = canvasEl.querySelector(`.block-wrapper[data-id="${block.id}"]`);
    if (wrapper) syncBlockPositionDom(wrapper, block);
  }
}

function onGlobalKeyup(e) {
  if (gestureActive) return;
  // un appui maintenu répète keydown mais keyup ne fire qu'une fois au
  // relâchement : la pression entière ne compte que pour une seule entrée
  // d'historique, comme un geste de glisser
  if (e.key.startsWith('Arrow')) pushHistory();
}

document.addEventListener('keydown', onGlobalKeydown);
document.addEventListener('keyup', onGlobalKeyup);

// panneau de référence listant tous les raccourcis (bouton "Raccourcis" de
// la barre du haut), à la manière du menu Édition de VSCode
function renderShortcutsList() {
  const list = document.getElementById('shortcutsList');
  if (!list) return;
  list.innerHTML = SHORTCUTS.map(([keys, label]) => `
    <li><span class="shortcut-label">${escapeHtml(label)}</span><span class="shortcut-keys">${escapeHtml(keys)}</span></li>
  `).join('');
}

function toggleShortcutsPanel(show) {
  const panel = document.getElementById('shortcutsPanel');
  if (!panel) return;
  panel.hidden = show === undefined ? !panel.hidden : !show;
}

const shortcutsBtnEl = document.getElementById('shortcutsBtn');
if (shortcutsBtnEl) {
  shortcutsBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShortcutsPanel();
  });
} else {
  console.error('élément introuvable : shortcutsBtn');
}
document.addEventListener('click', (e) => {
  const panel = document.getElementById('shortcutsPanel');
  if (!panel || panel.hidden) return;
  if (!panel.contains(e.target) && e.target.id !== 'shortcutsBtn') toggleShortcutsPanel(false);
});

// ---------- Pages ----------

function renderPagesBar() {
  const bar = document.getElementById('pagesBar');
  if (!bar) return;
  bar.innerHTML = state.pages.map((p, i) => `
    <button type="button" class="page-tab${i === state.currentPageIndex ? ' active' : ''}" data-index="${i}" title="Double-clic pour renommer">
      ${escapeHtml(p.name)}
      ${state.pages.length > 1 ? `<span class="page-tab-close" data-index="${i}" title="Supprimer cette page">×</span>` : ''}
    </button>
  `).join('') + `<button type="button" class="page-tab page-tab-add" id="addPageBtn" title="Ajouter une page">+</button>`;

  bar.querySelectorAll('.page-tab[data-index]').forEach(tab => {
    const index = Number(tab.dataset.index);
    tab.addEventListener('click', () => switchPage(index));
    tab.addEventListener('dblclick', () => renamePage(index));
  });
  bar.querySelectorAll('.page-tab-close').forEach(closeBtn => {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePage(Number(closeBtn.dataset.index));
    });
  });
  const addBtn = document.getElementById('addPageBtn');
  if (addBtn) addBtn.addEventListener('click', addPage);
}

function switchPage(index) {
  if (index === state.currentPageIndex || !state.pages[index]) return;
  state.currentPageIndex = index;
  state.selectedId = null;
  multiSelectIds.clear();
  render();
  renderPagesBar();
  // annuler vers les blocs d'une autre page n'aurait pas de sens — chaque
  // page a son propre historique implicite, repartant de son état actuel
  initHistory();
}

function addPage() {
  state.pages.push({ name: `Page ${state.pages.length + 1}`, blocks: [] });
  switchPage(state.pages.length - 1);
}

function renamePage(index) {
  const page = state.pages[index];
  if (!page) return;
  const name = prompt('Nom de la page :', page.name);
  if (!name || !name.trim()) return;
  page.name = name.trim();
  renderPagesBar();
}

function deletePage(index) {
  if (state.pages.length <= 1) { alert('Impossible de supprimer la dernière page.'); return; }
  state.pages.splice(index, 1);
  if (state.currentPageIndex >= state.pages.length) state.currentPageIndex = state.pages.length - 1;
  state.selectedId = null;
  multiSelectIds.clear();
  render();
  renderPagesBar();
  initHistory();
}

// ---------- Thème, sauvegarde, chargement, export ----------

themeSelectEl.addEventListener('change', () => {
  state.theme = themeSelectEl.value;
  applyTheme(canvasEl, state.theme);
});

projectNameEl.addEventListener('input', () => { state.name = projectNameEl.value; });

async function refreshLoadList() {
  const res = await fetch('/api/projects');
  const list = await res.json();
  loadSelectEl.innerHTML = '<option value="">Charger…</option>'
    + list.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
}

loadSelectEl.addEventListener('change', async () => {
  const name = loadSelectEl.value;
  if (!name) return;
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (!res.ok) { alert('Impossible de charger ce projet.'); return; }
  const project = await res.json();
  // rétrocompatibilité : les projets enregistrés avant les pages multiples
  // n'ont qu'un tableau "blocks" — on le convertit en une seule page
  const pages = Array.isArray(project.pages) && project.pages.length
    ? project.pages
    : [{ name: 'Page 1', blocks: project.blocks || [] }];
  state = { name: project.name, theme: project.theme, pages, currentPageIndex: 0, selectedId: null };
  projectNameEl.value = state.name;
  themeSelectEl.value = state.theme;
  render();
  renderPagesBar();
  // charger un autre projet ne doit pas permettre d'annuler vers les blocs
  // du projet précédent — historique repart de zéro sur ce nouvel état
  initHistory();
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const name = projectNameEl.value.trim();
  if (!name) { alert("Donnez un nom au projet avant d'enregistrer."); return; }
  state.name = name;
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: state.theme, pages: state.pages }),
  });
  if (!res.ok) { alert("Échec de l'enregistrement."); return; }
  await refreshLoadList();
});

// exporte uniquement la page actuellement affichée (pas tout le projet) —
// un fichier HTML par page, à exporter une par une si le projet en a plusieurs
document.getElementById('exportBtn').addEventListener('click', () => {
  const theme = getTheme(state.theme);
  const varsCss = ':root{' + Object.entries(theme.vars).map(([k, v]) => `--page-${k}: ${v};`).join(' ') + '}';
  const pageBlocks = getBlocks();
  const blocksHtml = pageBlocks.map(b => renderBlockContent(b, pageBlocks)).join('\n');
  const pageName = state.pages[state.currentPageIndex].name;
  const fontImport = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700&family=Playfair+Display:wght@600;700&family=Space+Grotesk:wght@500;700&family=Pacifico&display=swap');";

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(state.name)} — ${escapeHtml(pageName)}</title>
<style>
${fontImport}
${varsCss}
${PAGE_CSS}
</style>
</head>
<body>
<div class="page-canvas">
${blocksHtml}
</div>
</body>
</html>
`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = `${state.name}-${pageName}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `${slug || 'page'}.html`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Démarrage ----------

// PAGE_CSS (blocks.js) ne stylait jusqu'ici que le document exporté — sans
// cette injection, aucun style de bloc (police, alignement, boutons...) ne
// s'appliquait dans l'éditeur en direct, seulement dans le fichier exporté
function injectPageCss() {
  const style = document.createElement('style');
  style.textContent = PAGE_CSS;
  document.head.appendChild(style);
}

const paletteSearchEl = document.getElementById('paletteSearch');
if (paletteSearchEl) {
  paletteSearchEl.addEventListener('input', () => {
    paletteSearchQuery = paletteSearchEl.value;
    renderPalette();
  });
} else {
  console.error('élément introuvable : paletteSearch');
}

function init() {
  injectPageCss();
  renderPalette();
  renderThemeSelect();
  renderShortcutsList();
  refreshLoadList();
  render();
  renderPagesBar();
  initHistory();
}

init();
