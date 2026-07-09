const express = require('express');
const path = require('path');
const fs = require('fs');

const PORT = 4000;
const DB_PATH = path.join(__dirname, 'db', 'projects.json');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

function loadProjects() {
  if (!fs.existsSync(DB_PATH)) return {};
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveProjects(projects) {
  fs.writeFileSync(DB_PATH, JSON.stringify(projects, null, 2));
}

// liste des projets sauvegardés (nom + date, pas le contenu complet)
app.get('/api/projects', (req, res) => {
  const projects = loadProjects();
  const list = Object.values(projects).map(p => ({ name: p.name, updatedAt: p.updatedAt }));
  res.json(list);
});

app.get('/api/projects/:name', (req, res) => {
  const projects = loadProjects();
  const project = projects[req.params.name];
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  res.json(project);
});

// crée ou remplace un projet (nom = clé) — pas d'auth, outil local mono-utilisateur
app.put('/api/projects/:name', (req, res) => {
  const { theme, pages } = req.body;
  if (!Array.isArray(pages) || !pages.length) return res.status(400).json({ error: 'pages doit être un tableau non vide.' });
  if (!pages.every(p => p && typeof p === 'object' && Array.isArray(p.blocks))) {
    return res.status(400).json({ error: 'chaque page doit avoir un tableau blocks.' });
  }

  const projects = loadProjects();
  projects[req.params.name] = {
    name: req.params.name,
    theme: theme || 'minimal-light',
    pages,
    updatedAt: new Date().toISOString(),
  };
  saveProjects(projects);
  res.json({ ok: true });
});

app.delete('/api/projects/:name', (req, res) => {
  const projects = loadProjects();
  delete projects[req.params.name];
  saveProjects(projects);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`SiteBuilder lancé sur http://localhost:${PORT}`);
});
