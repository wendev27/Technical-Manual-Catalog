(() => {
  const input = document.getElementById('search');
  const catalog = document.getElementById('catalog');
  const results = document.getElementById('results');
  const rescanButton = document.getElementById('rescan');
  const searchResults = document.createElement('div');
  searchResults.className = 'catalog';
  searchResults.hidden = true;
  catalog.after(searchResults);

  const pageSize = 100;
  let scanData;
  let searchTimer;
  let searchRequest = 0;

  function formatCount(value) {
    return Number(value).toLocaleString();
  }

  function setStatus(message) {
    results.textContent = message;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function fileUrl(relativePath) {
    return `/files/${relativePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  }

  function renderFile(file) {
    const link = makeElement('a', 'entry');
    link.href = fileUrl(file.path);
    const badge = makeElement('span', `file-badge ${file.category}`, file.label);
    badge.setAttribute('aria-hidden', 'true');
    link.append(
      badge,
      makeElement('span', 'entry-name', file.name),
      makeElement('span', 'entry-path', file.parentPath)
    );
    return link;
  }

  async function requestJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  async function getDirectory(path, offset = 0) {
    const query = new URLSearchParams({ path, offset: String(offset), limit: String(pageSize) });
    return requestJson(`/api/list?${query}`);
  }

  function renderLoadMore(container, path, offset, onError) {
    const button = makeElement('button', 'button load-more', 'Load more');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Loading…';
      try {
        const data = await getDirectory(path, offset);
        button.remove();
        renderItems(container, data.items, path);
        if (data.hasMore) {
          renderLoadMore(container, path, data.nextOffset, onError);
        }
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Retry loading';
        onError(error);
      }
    });
    container.append(button);
  }

  async function loadFolder(details, path) {
    if (details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
    details.dataset.loading = 'true';
    const body = details.querySelector('.folder-body');
    body.replaceChildren(makeElement('p', 'support-note', 'Loading folder…'));
    try {
      const data = await getDirectory(path);
      body.replaceChildren();
      renderItems(body, data.items, path);
      if (data.items.length === 0) {
        body.append(makeElement('p', 'empty-note', 'This folder is empty.'));
      }
      if (data.hasMore) {
        renderLoadMore(body, path, data.nextOffset, (error) => {
          setStatus(`Could not load more items: ${error.message}`);
        });
      }
      details.dataset.loaded = 'true';
    } catch (error) {
      body.replaceChildren(makeElement('p', 'empty-note', `Could not load folder: ${error.message}`));
      setStatus(`Could not load folder: ${error.message}`);
    } finally {
      delete details.dataset.loading;
    }
  }

  function renderFolder(folder) {
    const details = makeElement('details', 'folder');
    details.dataset.path = folder.path;
    const summary = makeElement('summary');
    summary.append(
      makeElement('span', 'folder-icon', '▰'),
      makeElement('span', 'folder-name', folder.name),
      makeElement('span', 'folder-badges')
    );
    const body = makeElement('div', 'folder-body');
    body.append(makeElement('p', 'support-note', 'Open to load this folder.'));
    details.append(summary, body);
    details.addEventListener('toggle', () => {
      if (details.open) loadFolder(details, folder.path);
    });
    return details;
  }

  function renderItems(container, items, parentPath) {
    const list = makeElement('div', 'entry-list');
    for (const item of items) {
      if (item.type === 'directory') {
        container.append(renderFolder(item));
      } else {
        list.append(renderFile(item));
      }
    }
    if (list.childElementCount) container.append(list);
    if (items.length === 0 && parentPath === '') {
      container.append(makeElement('p', 'empty-note', 'No visible files or folders were found.'));
    }
  }

  async function loadRoot() {
    catalog.setAttribute('aria-busy', 'true');
    catalog.replaceChildren(makeElement('p', 'support-note', 'Loading drive contents…'));
    try {
      const data = await getDirectory('');
      catalog.replaceChildren();
      renderItems(catalog, data.items, '');
      if (data.hasMore) renderLoadMore(catalog, '', data.nextOffset, (error) => {
        setStatus(`Could not load more items: ${error.message}`);
      });
    } catch (error) {
      catalog.replaceChildren(makeElement('p', 'empty-note', `Could not load drive contents: ${error.message}`));
      setStatus(`Could not load drive contents: ${error.message}`);
    } finally {
      catalog.setAttribute('aria-busy', 'false');
    }
  }

  function renderSearchResults(items, append = false) {
    const list = append ? searchResults.querySelector('.entry-list') : null;
    const entryList = list || makeElement('div', 'entry-list');
    for (const item of items) entryList.append(renderFile(item));
    if (!list) {
      searchResults.replaceChildren();
      if (entryList.childElementCount) searchResults.append(entryList);
    }
  }

  async function search(query, requestId, offset = 0, append = false) {
    const params = new URLSearchParams({
      q: query,
      offset: String(offset),
      limit: String(pageSize),
    });
    try {
      const data = await requestJson(`/api/search?${params}`);
      if (requestId !== searchRequest) return;
      if (!append) {
        searchResults.replaceChildren();
        renderSearchResults(data.items);
      } else {
        renderSearchResults(data.items, true);
      }
      searchResults.hidden = false;
      catalog.hidden = true;
      if (data.items.length === 0) {
        searchResults.append(makeElement('p', 'empty-note', 'No matching files.'));
      }
      if (data.hasMore) {
        const button = makeElement('button', 'button load-more', 'Load more results');
        button.type = 'button';
        button.addEventListener('click', () => {
          button.remove();
          search(query, requestId, data.nextOffset, true);
        });
        searchResults.append(button);
      }
      setStatus(
        `${formatCount(data.total)} matching file${data.total === 1 ? '' : 's'}${
          data.total > data.items.length ? `; showing ${formatCount(data.items.length)}` : ''
        }.`
      );
    } catch (error) {
      if (requestId !== searchRequest) return;
      searchResults.replaceChildren(makeElement('p', 'empty-note', `Search failed: ${error.message}`));
      searchResults.hidden = false;
      catalog.hidden = true;
      setStatus(`Search failed: ${error.message}`);
    }
  }

  async function scan() {
    rescanButton.disabled = true;
    clearTimeout(searchTimer);
    searchRequest++;
    setStatus('Scanning drive…');
    try {
      scanData = await requestJson('/api/scan');
      document.getElementById('document-count').textContent = formatCount(scanData.stats.documents);
      document.getElementById('folder-count').textContent = formatCount(scanData.stats.folders);
      document.getElementById('file-count').textContent = formatCount(scanData.stats.files);
      await loadRoot();
      const query = input.value.trim();
      if (query) await search(query, ++searchRequest);
      if (scanData.warnings.length) {
        setStatus(
          `${results.textContent} Scan warnings: ${formatCount(scanData.warnings.length)}. ${scanData.warnings[0]}`
        );
      } else if (!query) {
        setStatus(`Showing ${formatCount(scanData.stats.folders)} folders and ${formatCount(scanData.stats.files)} files.`);
      }
    } catch (error) {
      catalog.replaceChildren(makeElement('p', 'empty-note', `Could not scan drive: ${error.message}`));
      setStatus(`Could not scan drive: ${error.message}`);
    } finally {
      rescanButton.disabled = false;
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    const requestId = ++searchRequest;
    if (!query) {
      searchResults.hidden = true;
      catalog.hidden = false;
      searchResults.replaceChildren();
      setStatus(
        scanData
          ? `Showing ${formatCount(scanData.stats.folders)} folders and ${formatCount(scanData.stats.files)} files.`
          : 'Scanning drive…'
      );
      return;
    }
    searchResults.replaceChildren(makeElement('p', 'support-note', 'Searching…'));
    searchResults.hidden = false;
    catalog.hidden = true;
    searchTimer = setTimeout(() => search(query, requestId), 180);
  });

  rescanButton.addEventListener('click', scan);
  document.getElementById('expand').addEventListener('click', () => {
    for (const folder of catalog.querySelectorAll(':scope > .folder')) folder.open = true;
  });
  document.getElementById('collapse').addEventListener('click', () => {
    for (const folder of catalog.querySelectorAll('.folder[open]')) folder.open = false;
  });

  scan();
})();
