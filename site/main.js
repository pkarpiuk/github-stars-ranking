var usersGrid = null;
// db.js może nie mieć COMPARE (stary plik albo brak historii) – wtedy kolumna Change i lista "Compare to" się nie pojawiają
var hasCompare = typeof COMPARE !== 'undefined' && COMPARE.length > 0;
var currentCompare = null;   // snapshot wybrany w "Compare to" (ustawiany w refresh)
var topicsGrid = null;
var languagesGrid = null;

Ext.onReady(function () {
	var usersMap = {};
	var topicsMap = {};
	var langMap = {};

	var dataFun = function (map, exclusions) {
		if (!exclusions) {
			exclusions = new Set();
		}
		return Object.keys(map).filter(key => !exclusions.has(key)).map(key => ({
			checked: false,
			name: key,
			count: map[key].count,
			stars: map[key].stars,
			stars2count: map[key].stars / map[key].count
		})).sort((r1, r2) => -(r1.stars - r2.stars));
	}

	RANKING.map(function ([fname, stars]) {
		var repo = REPOS[fname] || {};
		var topics = repo.topics || [];
		var uname = fname.split(/\//)[1];
		topics.forEach(function (topic) {
			topicsMap[topic] = topicsMap[topic] || { count: 0, stars: 0 };
			topicsMap[topic].count += 1;
			topicsMap[topic].stars += stars;
		});
		var lang = repo.language || '?';
		langMap[lang] = langMap[lang] || { count: 0, stars: 0 };
		langMap[lang].count += 1;
		langMap[lang].stars += stars;
		usersMap[uname] = usersMap[uname] || { count: 0, stars: 0 };
		usersMap[uname].count += 1;
		usersMap[uname].stars += stars;
	});
	// fields: ['checked', 'name', 'count', 'stars']
	var topicsExclusions = new Set(['javascript', 'python', 'java', 'typescript', 'go', 'c-plus-plus', 'c', 'html', 'php', 'ruby', 'swift', 'shell', 'rust', 'css', 'objective-c', 'vue', 'jupyter-notebook', 'kotlin', 'c-sharp', 'dart', 'scala', 'lua',
		'assembly', 'tex', 'clojure', 'coffeescript', 'objective-c-plus-plus', 'dockerfile', 'haskell', 'elixir', 'ocaml', 'julia', 'makefile', 'batchfile', 'emacs-lisp', 'standard-ml', 'rascal', 'crystal', 'viml', 'perl', 'qml', 'markdown', 'scss'
	]);
	usersGrid = createFilterGrid(dataFun(usersMap));
	topicsGrid = createFilterGrid(dataFun(topicsMap, topicsExclusions));
	languagesGrid = createFilterGrid(dataFun(langMap), function (value) { return languageHtml(value === '?' ? '' : value) || Ext.String.htmlEncode(value); });

	grid = Ext.create('Ext.grid.Panel', {
		border: false,
		cls: 'ranking-grid',   // stała wysokość wiersza (index.html), żeby ikony i kropki języków nie rozpychały wierszy w miarę ładowania
		store: Ext.create('Ext.data.ArrayStore', {
			fields: ['rank', 'name', 'prev', 'created_at', 'stars', 'gain', 'gainPct', 'desc', 'language', 'created', 'forks', 'subscribers', 'topics', 'avatar_url', 'html_url', 'ri']
		}),
		columns: [
			{ header: 'Rank', width: 40, dataIndex: 'rank', align: 'right' },
			{
				header: 'Name', width: 250, dataIndex: 'name', renderer: function (value, metaData, record) {
					return `<img src="${record.get('avatar_url')}" width="14" height="14" style="width: 14px; height: 14px;"> ${value}`;
				}
			},
			{ header: 'Change', width: 70, align: 'center', dataIndex: 'prev', hidden: !hasCompare, sortable: false, renderer: changeRenderer },
			{
				header: 'Stars', width: 55, dataIndex: 'stars', align: 'right', renderer: function (value, metaData, record, rowIndex, colIndex, store, view) {
					return value;
				}
			},
			{ header: 'Gain', width: 125, align: 'right', dataIndex: 'gain', hidden: !hasCompare, sortable: false, renderer: gainRenderer },
			{ header: 'Description', flex: 1, dataIndex: 'desc', renderer: function (value) { return Ext.String.htmlEncode(value || ''); } },
			{ header: 'Language', width: 120, dataIndex: 'language', renderer: function (value) { return languageHtml(value); } },
			{ header: 'Created', width: 60, dataIndex: 'created', align: 'right' },
			{ header: 'Forks', width: 60, dataIndex: 'forks', align: 'right' },
			{ header: 'Subscribers', width: 70, dataIndex: 'subscribers', align: 'right' },
			{ header: 'Topics', width: 70, dataIndex: 'topics', flex: 1, renderer: function (value) { return Ext.String.htmlEncode(value || ''); } }
		],
		listeners: {
			itemdblclick: function (slf, record, item, index, e, eOpts) {
				buttonClick();
			},
			selectionchange: function (selModel, selected, eOpts) {
				var record = null;
				if (selected.length) {
					record = selected[0];
				}
				setInfoPanel(record);
			}
		}
	});
	Ext.create('Ext.container.Viewport', {
		border: false,
		renderTo: Ext.getBody(),
		layout: {
			type: 'border',
			regionWeights: {
				west: 20,
				north: 30,
				south: 10,
				east: 20
			}
		},
		items: [
			{
				region: 'north',
				height: 60,
				border: false,
				html: '<div id="banner"><div>GitHub Stars Ranking' + rankingDateHtml() + '</div></div>'
			},
			{
				region: 'center',
				layout: 'fit',
				dockedItems: [
					{
						id: 'main-toolbar',
						xtype: 'toolbar',
						dock: 'top',
						defaultButtonUI: 'default',
						items: [
							...(hasCompare ? [
								'Compare to',
								{
									id: 'compare-field',
									xtype: 'combo',
									queryMode: 'local',
									editable: false,
									width: 232,
									autoSelect: true,
									submitEmptyText: false,
									triggerAction: 'all',
									value: 0,
									store: COMPARE.map(function (c, i) { return [i, c.label]; }),
									listeners: {
										change: function (slf, newValue, oldValue, eOpts) {
											refresh();
										}
									}
								}
							] : []),
							'->',
							'Search in',
							{
								id: 'search-in-field',
								xtype: 'combo',
								queryMode: 'local',
								editable: false,
								width: 100,
								autoSelect: true,
								submitEmptyText: false,
								triggerAction: 'all',
								value: 'name+desc',
								store: [['name', 'Name'], ['name+desc', 'Name+Desc'], ['desc', 'Desc']]
							},
							'Phrase',
							{
								id: 'phrase-field', xtype: 'textfield', width: 160,
								listeners: {
									specialkey: function (field, e) {
										if (e.getKey() == e.ENTER) {
											refresh(true);
										}
									}
								}
							},
							{ xtype: 'button', text: 'Clear', handler: function () { Ext.getCmp('phrase-field').reset(); refresh(true); } },
							{ xtype: 'button', text: '<b>Search</b>', handler: function () { refresh(true); } },
							' ',
							'-'
						]
					},
					...(hasCompare ? [{
						id: 'main-toolbar2',
						xtype: 'toolbar',
						dock: 'top',
						defaultButtonUI: 'default',
						items: [
								{ xtype: 'tbspacer', id: 'sort-lead', width: 14 },
								{ xtype: 'tbtext', id: 'sort-label', text: 'Sort by' },
								{
									id: 'sort-field',
									xtype: 'combo',
									queryMode: 'local',
									editable: false,
									width: 140,
									autoSelect: true,
									submitEmptyText: false,
									triggerAction: 'all',
									value: 'stars',
									store: [['stars', 'Stars'], ['gain', 'Stars gained'], ['gainPct', 'Stars gained %'], ['climb', 'Positions gained']],
									listeners: {
										change: function (slf, newValue, oldValue, eOpts) {
											refresh();
										}
									}
								},
								{ xtype: 'tbspacer', id: 'sort-gap', width: 10 },
								{ xtype: 'tbtext', id: 'show-label', text: 'Show' },
								{
									id: 'show-field',
									xtype: 'combo',
									queryMode: 'local',
									editable: false,
									width: 110,
									autoSelect: true,
									submitEmptyText: false,
									triggerAction: 'all',
									value: 'all',
									store: [['all', 'All'], ['new', 'New'], ['climb', 'Climbers'], ['fall', 'Fallers']],
									listeners: {
										change: function (slf, newValue, oldValue, eOpts) {
											refresh();
										}
									}
								}
						]
					}] : [])
				],
				items: grid,
				bbar: [
					{ id: 'status-bar', xtype: 'tbtext', text: '&nbsp;' },
					'->',
					{ id: 'status-bar2', xtype: 'tbtext', text: '&nbsp;' },
				],
			},
			{
				region: 'east',
				width: 520,
				layout: 'border',
				items: [
					{ region: 'center', title: 'Topics', layout: 'fit', items: topicsGrid },
					{
						region: 'north', height: '30%', title: 'Users', layout: 'fit', items: usersGrid
					},
					{ region: 'south', height: '30%', title: 'Languages', layout: 'fit', items: languagesGrid }
				]
			},
			{
				id: 'info-panel',
				autoScroll: true,
				bodyPadding: 10,
				region: 'south',
				height: 300,
				title: 'Repo Info'
			}
		],
		listeners: {
			afterrender: {
				fn: function () {
					placeSortShow();
					Ext.EventManager.onWindowResize(placeSortShow, null, { buffer: 150 });
					refresh();
				},
				single: true
			}
		}
	});
});

// " (2026-11-10)" z RANKING_TS (generowanego przez worker); pełny znacznik czasu w dymku. Brak daty (stary db.js) = nic nie pokazujemy.
function rankingDateHtml() {
	var m = (typeof RANKING_TS === 'string') && /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(RANKING_TS);
	if (!m) { return ''; }
	return ' <span style="font-size: 18px;" title="Ranking z ' + m[1] + ' ' + m[2] + '">(' + m[1] + ')</span>';
}

function createFilterGrid(data, nameRenderer) {
	var localRefresh = function () {
		var phrase = grid.down('#the-phrase').getValue().trim();
		grid.getStore().clearFilter();
		try {
			grid.getStore().filter({ property: 'name', value: new RegExp(phrase) });
		} catch(ex) {}
	}
	var selectionCounter = 0;
	var grid = Ext.create('Ext.grid.Panel', {
		// Tabele filtrów mają razem ok. 27 tys. wierszy (użytkownicy, tematy, języki). Bez buforowanego renderowania ExtJS tworzy
		// dla nich ok. 390 tys. węzłów DOM i start strony trwa kilkanaście sekund (kilkadziesiąt na wolniejszym komputerze).
		plugins: 'bufferedrenderer',
		dockedItems: [
			{
				itemId: 'toolbar',
				xtype: 'toolbar',
				dock: 'top',
				defaultButtonUI: 'default',
				items: [
					'selections:',
					{ itemId: 'indicator', xtype: 'tbtext', text: '<b>0</b>' },
					{
						xtype: 'button', text: 'Clear selection', handler: function () {
							selectionCounter = 0;
							grid.down('#indicator').setText('<b>' + selectionCounter + '</b>');
							setTimeout(function () {
								refresh();
								setTimeout(function () {
									grid.getStore().each(rec => rec.set('checked', false));
								}, 100)
							}, 100);
						}
					},
					'->',
					'Name filter',
					{
						itemId: 'the-phrase',
						xtype: 'textfield', width: 110,
						listeners: {
							specialkey: function (field, e) {
								if (e.getKey() == e.ENTER) {
									localRefresh();
								}
							}
						}
					},
					{
						xtype: 'button', text: 'Clear', handler: function () {
							grid.down('#the-phrase').setValue('');
							localRefresh();
						}
					},
					{ xtype: 'button', text: '<b>Search</b>', handler: function () { localRefresh(); } },
				]
			}],
		border: false,
		store: Ext.create('Ext.data.ArrayStore', {
			fields: ['checked', 'name', 'count', 'stars', 'stars2count']
		}),
		columns: [
			{ header: '#', xtype: 'rownumberer', width: 40 },
			{
				header: '', width: 40, dataIndex: 'checked', xtype: 'checkcolumn', listeners: {
					checkchange: function (column, rowIndex, checked) {
						selectionCounter += (checked ? 1 : -1);
						grid.down('#indicator').setText('<b>' + selectionCounter + '</b>');
						setTimeout(function () {
							refresh();
						}, 100);
					}
				}
			},
			{ header: 'Name', flex: 1, dataIndex: 'name', renderer: nameRenderer },
			{ header: 'Count', width: 100, dataIndex: 'count', align: 'right' },
			{ header: '&Sigma; Stars', width: 100, dataIndex: 'stars', align: 'right' },
			{
				header: '&Sigma; Stars / Count', width: 100, dataIndex: 'stars2count', align: 'right', renderer: function (value, metaData, record) {
					return value.toFixed(2);
				}
			},
		],
		listeners: {
			selectionchange: function (selModel, selected, eOpts) {
				var record = null;
				if (selected.length) {
					record = selected[0];
				}
				setInfoPanel(record);
			}
		}
	});
	grid.getStore().loadData(data);
	grid.getSelectionSet = function () {
		var result = new Set();
		if (selectionCounter > 0) {
			grid.getStore().data.items.forEach(function (item) {
				var r = item.data;
				if (r.checked) {
					result.add(r.name);
				}
			});
		}
		return result;
	};
	return grid;
}

var globalCompHash = {};
function refresh(searchFlag) {
	// fields: ['rank', 'name', 'stars', 'desc', 'language', 'created', 'forks', 'watchers', 'subscribers', 'topics']
	var users = usersGrid.getSelectionSet();
	var languages = languagesGrid.getSelectionSet();
	var topics = topicsGrid.getSelectionSet();
	var phrase = Ext.getCmp('phrase-field').getValue();
	var searchIn = Ext.getCmp('search-in-field').getValue();
	currentCompare = hasCompare ? COMPARE[Ext.getCmp('compare-field').getValue()] : null;
	var fields = [];
	if (phrase) {
		try {
			phrase = new RegExp(phrase.toLowerCase());
		} catch(ex){}
		switch (searchIn) {
			case 'name': fields = ['full_name']; break;
			case 'name+desc': fields = ['full_name', 'description']; break;
			case 'desc': fields = ['description']; break;
		}
	}
	let store = RANKING.filter(function (pair, index) {
		const fullName = pair[0];
		pair[2] = index;   // pozycja w bieżącym rankingu (wcześniej push – tablice rosły przy każdym odświeżeniu)
		const stars = pair[1];
		const repo = REPOS[fullName];
		if (languages.size) {
			var language = repo.language || '?';
			if (!languages.has(language)) {
				return false;
			}
		}
		if (users.size) {
			var user = fullName.split(/\//)[1];
			if (!users.has(user)) {
				return false;
			}
		}
		if (topics.size) {
			let found = false;
			var topicArr = repo.topics || [];
			topicArr.forEach(function (t) {
				if (topics.has(t)) {
					found = true;
				}
			});
			if (!found) {
				return false;
			}
		}
		if (phrase) {
			var found = false;
			for (var i = 0; i < fields.length; i++) {
				var fieldName = fields[i];
				if((repo[fieldName] || '').toLowerCase().match(phrase)) {
					found = true;
				}
			}
			if(!found) {
				return false;
			}
		}
		return true;
	}).map(function (pair, index) {
		const fullName = pair[0];
		const stars = pair[1];
		const ri = pair[2];
		const repo = REPOS[fullName];
		var prev = currentCompare ? currentCompare.ranks[ri] : null;
		var gain = null, gainPct = null;
		if (currentCompare) {
			var oldStars = currentCompare.stars ? currentCompare.stars[ri] : 0;
			if (prev > 0 && oldStars > 0) {
				gain = stars - oldStars;
				gainPct = 100 * gain / oldStars;
			} else if (prev === 0 && createdAfterSnapshot(repo.created_at)) {
				gain = stars;   // repozytorium powstało po snapshocie: wszystkie jego gwiazdki to przyrost (bez wartości procentowej)
			}
		}
		return {
			rank: ri + 1, ri: ri, name: fullName.substr(1), prev: prev, created_at: repo.created_at, stars: stars, gain: gain, gainPct: gainPct, desc: (repo.description || '').replace(/<[^>]*>/, ''), language: repo.language, created: (repo.created_at || '').substring(0, 7), forks: repo.forks_count, subscribers: repo.subscribers_count,
			topics: (repo.topics || []).join(', '), avatar_url: repo.avatar_url, html_url: repo.html_url
		};
	});
	if (hasCompare) {
		var showType = Ext.getCmp('show-field').getValue();
		if (showType !== 'all') {
			store = store.filter(function (r) {
				if (showType === 'new') { return r.prev === 0 && createdAfterSnapshot(r.created_at); }
				if (showType === 'climb') { return r.prev > 0 && r.prev - r.rank > 0; }
				if (showType === 'fall') { return r.prev > 0 && r.prev - r.rank < 0; }
				return true;
			});
		}
		var sortType = Ext.getCmp('sort-field').getValue();
		if (sortType !== 'stars') {
			// wiersze bez wartości (brak danych w snapshocie) trafiają na koniec; remis rozstrzyga pozycja w rankingu
			var key = function (r) {
				var v = sortType === 'gain' ? r.gain : sortType === 'gainPct' ? r.gainPct : (r.prev > 0 ? r.prev - r.rank : null);
				return v === null || v === undefined ? -Infinity : v;
			};
			store.sort(function (a, b) {
				var ka = key(a), kb = key(b);
				return ka === kb ? a.rank - b.rank : (kb > ka ? 1 : -1);
			});
		}
	}
	store = store.slice(0, 300);
	grid.getStore().loadData(store);
}

// Zmiana pozycji względem snapshotu z "Compare to": prev = pozycja w tamtym rankingu (0 = nie było go w nim).
// Dodatnia różnica (prev - rank) = awans. Pozycje to pozycje w pełnym rankingu, niezależne od filtrów.
function changeRenderer(value, metaData, record) {
	if (value === null || value === undefined || !currentCompare) {
		return '';
	}
	if (value === 0) {
		var snapDate = currentCompare.ts.substring(0, 10);
		var createdMs = Date.parse(record.get('created_at'));
		if (!isNaN(createdMs) && createdMs < Date.parse(currentCompare.ts)) {
			// Repozytorium istniało już w chwili snapshotu, więc nie jest nowe, a mimo to nie ma go w tamtych danych.
			return '<span style="color: #888;" title="Created ' + record.get('created_at').substring(0, 10) + ', before the ' + snapDate + ' ranking, but not in its top ' + currentCompare.n + ' under this name: it was below the cut-off, was renamed or moved since, or is missing from that snapshot\'s data">n/a</span>';
		}
		return '<span style="font-size: 80% !important; background-color: yellow;" title="Created after the ' + snapDate + ' ranking">NEW</span>';
	}
	var delta = value - record.get('rank');
	var title = 'was #' + value;
	if (delta < 0) {
		return '<span style="color: red" title="' + title + '"><span style="font-size: 16px !important;">&darr;</span> ' + (-delta) + '</span>';
	} else if (delta > 0) {
		return '<span style="color: green" title="' + title + '"><span style="font-size: 16px !important;">&uarr;</span> ' + delta + '</span>';
	}
	return '<span title="' + title + '">&mdash;</span>';
}

// ---- pomocnicze: dane porównawcze i formatowanie -------------------------------------------------------------------------------
// "Sort by" i "Show": od szerokości okna 1920 px w pierwszym rzędzie pasku (po prawej od "Compare to"), poniżej tej szerokości
// w drugim rzędzie. Komponenty są przenoszone między paskami (bez niszczenia), więc ich wartości zostają.
var SORT_SHOW_PARTS = ['sort-lead', 'sort-label', 'sort-field', 'sort-gap', 'show-label', 'show-field'];
function placeSortShow() {
	if (!hasCompare) {
		return;
	}
	var tb1 = Ext.getCmp('main-toolbar'), tb2 = Ext.getCmp('main-toolbar2');
	if (!tb1 || !tb2) {
		return;
	}
	var wide = window.innerWidth >= 1920;
	var parts = SORT_SHOW_PARTS.map(function (id) { return Ext.getCmp(id); });
	if ((parts[0].ownerCt === tb1) === wide) {
		return;   // już na właściwym pasku
	}
	parts.forEach(function (c) { c.ownerCt.remove(c, false); });
	if (wide) {
		parts.forEach(function (c, k) { tb1.insert(2 + k, c); });   // po "Compare to" i jego polu
		tb2.hide();
	} else {
		parts.forEach(function (c) { tb2.add(c); });
		tb2.show();
	}
	tb1.ownerCt.doLayout();
}

function createdAfterSnapshot(createdAt) {
	var ms = Date.parse(createdAt);
	return !!currentCompare && !isNaN(ms) && ms >= Date.parse(currentCompare.ts);
}

function formatNum(n) {
	return Math.round(n).toLocaleString('en-US');
}

function esc(s) {
	return Ext.String.htmlEncode(String(s));
}

// Przyrost gwiazdek od snapshotu z "Compare to": gain = różnica, gainPct = procent względem stanu ze snapshotu.
// Repozytorium utworzone po snapshocie: cały stan to przyrost (bez procentu). Brak danych ze snapshotu: n/a.
function gainRenderer(value, metaData, record) {
	if (!currentCompare) {
		return '';
	}
	if (value === null || value === undefined) {
		return '<span style="color: #888;" title="No star count for this repository in that snapshot">n/a</span>';
	}
	var pct = record.get('gainPct');
	var color = value > 0 ? 'green' : (value < 0 ? 'red' : '#888');
	var text = (value > 0 ? '+' : '') + formatNum(value);
	var tail = (pct === null || pct === undefined)
		? ' <span style="color: #888; font-size: 80%;">new</span>'
		: ' <span style="color: #888;">(' + (pct > 0 ? '+' : '') + (Math.abs(pct) >= 10 ? Math.round(pct) : pct.toFixed(1)) + '%)</span>';
	return '<span style="color: ' + color + ';" title="Stars gained since the ' + currentCompare.ts.substring(0, 10) + ' ranking">' + text + '</span>' + tail;
}

// Nazwa języka z kolorową kropką (kolory z language_colors.json przez LANG_COLORS; języki bez koloru dostają pustą kropkę).
function languageHtml(name) {
	if (!name) {
		return '';
	}
	var c = (typeof LANG_COLORS !== 'undefined') ? LANG_COLORS[name] : null;
	var color = (c && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : null;
	var dot = '<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; box-sizing: border-box; ' +
		(color ? 'background: ' + color + ';' : 'border: 1px dashed #bbb;') + '"></span>';
	return dot + esc(name);
}

// ---- wykresy historii (pozycja i gwiazdki w porównywanych snapshotach + dziś), czysty SVG --------------------------------------
function sparkline(title, points, invert, fmt) {
	var known = points.filter(function (p) { return p.v !== null && p.v > 0; });
	if (known.length < 2) {
		return '';
	}
	var W = 210, H = 60, P = 8;
	var t0 = known[0].t, t1 = known[known.length - 1].t;
	var vals = known.map(function (p) { return p.v; });
	var vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);
	if (vmax === vmin) { vmax += 1; vmin -= 1; }
	var x = function (t) { return P + (W - 2 * P) * (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)); };
	var y = function (v) { var f = (v - vmin) / (vmax - vmin); return invert ? P + (H - 2 * P) * f : H - P - (H - 2 * P) * f; };
	var path = known.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
	var dots = known.map(function (p) {
		return '<circle cx="' + x(p.t).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="3" fill="#4b0082"><title>' + esc(p.label) + ': ' + fmt(p.v) + '</title></circle>';
	}).join('');
	var first = known[0], last = known[known.length - 1];
	return '<div class="spark" style="display: inline-block; margin: 0 16px 6px 0; vertical-align: top;">' +
		'<div style="font-size: 90%; color: #555;">' + title + '</div>' +
		'<svg width="' + W + '" height="' + H + '" style="background: #fafafa; border: 1px solid #ddd;"><path d="' + path + '" fill="none" stroke="#4b0082" stroke-width="1.5"/>' + dots + '</svg>' +
		'<div style="font-size: 80%; color: #777; display: flex; justify-content: space-between; width: ' + W + 'px;"><span>' + esc(first.label) + ' ' + fmt(first.v) + '</span><span>' + esc(last.label) + ' ' + fmt(last.v) + '</span></div></div>';
}

function historyHtml(ri) {
	if (!hasCompare) {
		return '';
	}
	var ranks = [], stars = [];
	COMPARE.slice().sort(function (a, b) { return Date.parse(a.ts) - Date.parse(b.ts); }).forEach(function (c) {
		var t = Date.parse(c.ts), label = c.ts.substring(0, 10);
		ranks.push({ t: t, label: label, v: c.ranks[ri] });
		stars.push({ t: t, label: label, v: c.stars ? c.stars[ri] : null });
	});
	var nowTs = (typeof RANKING_TS !== 'undefined') ? RANKING_TS : new Date().toISOString();
	ranks.push({ t: Date.parse(nowTs), label: nowTs.substring(0, 10), v: ri + 1 });
	stars.push({ t: Date.parse(nowTs), label: nowTs.substring(0, 10), v: RANKING[ri][1] });
	var charts = sparkline('Rank (lower is better)', ranks, true, function (v) { return '#' + formatNum(v); }) + sparkline('Stars', stars, false, formatNum);
	return '<div><b>History</b> <span style="color: #888; font-size: 85%;">(compared snapshots + now)</span><br>' +
		(charts || '<span style="color: #888;">No earlier data for this repository in the compared snapshots.</span>') + '</div>';
}

// ---- szczegóły repozytorium pobierane PRZEZ PRZEGLĄDARKĘ z GitHub REST API (bez serwera i bez tokenu) -------------------------
// Zapytania anonimowe: limit 60/godz. na adres IP, więc: opóźnienie po zaznaczeniu wiersza (szybkie przeglądanie nie zużywa limitu),
// pamięć podręczna wyników na czas sesji i 2 zapytania na repozytorium (dane repozytorium + języki).
var repoDetailsCache = {};
var repoDetailsTimer = null;
var currentDetailsRepo = null;

function timeAgo(iso) {
	var days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
	if (isNaN(days)) { return ''; }
	if (days < 1) { return 'today'; }
	if (days < 60) { return days + ' day' + (days === 1 ? '' : 's') + ' ago'; }
	if (days < 730) { return Math.round(days / 30.4) + ' months ago'; }
	return (days / 365.25).toFixed(1) + ' years ago';
}

function loadRepoDetails(fullName) {
	clearTimeout(repoDetailsTimer);
	var el = document.getElementById('repo-details');
	if (!el) {
		return;
	}
	var cached = repoDetailsCache[fullName.toLowerCase()];
	if (cached) {
		renderRepoDetails(el, cached);
		return;
	}
	el.innerHTML = '<span style="color: #888;">Loading details from GitHub...</span>';
	repoDetailsTimer = setTimeout(function () { fetchRepoDetails(fullName); }, 350);
}

function fetchRepoDetails(fullName) {
	var base = 'https://api.github.com/repos/' + fullName;
	var quota = {};
	var grab = function (res) {
		quota = { remaining: res.headers.get('x-ratelimit-remaining'), limit: res.headers.get('x-ratelimit-limit'), reset: res.headers.get('x-ratelimit-reset') };
		return res;
	};
	var show = function (html) {
		var el = document.getElementById('repo-details');
		if (el && currentDetailsRepo === fullName) { el.innerHTML = html; }
	};
	fetch(base, { headers: { 'Accept': 'application/vnd.github+json' } })
		.then(function (res) {
			grab(res);
			if (!res.ok) { throw { status: res.status, quota: quota }; }
			return res.json();
		})
		.then(function (repo) {
			return fetch(base + '/languages').then(function (res) { grab(res); return res.ok ? res.json() : {}; })
				.then(function (langs) { return { repo: repo, langs: langs, quota: quota }; });
		})
		.then(function (d) {
			repoDetailsCache[fullName.toLowerCase()] = d;
			var el = document.getElementById('repo-details');
			if (el && currentDetailsRepo === fullName) { renderRepoDetails(el, d); }
		})
		.catch(function (e) {
			var msg;
			if (e && e.status === 403 || e && e.status === 429) {
				var reset = e.quota && e.quota.reset ? new Date(Number(e.quota.reset) * 1000).toLocaleTimeString() : 'later';
				msg = 'GitHub API request limit reached (anonymous access allows 60 requests per hour per IP address). Try again after ' + reset + '.';
			} else if (e && e.status === 404) {
				msg = 'Not found on GitHub (the repository may have been deleted, made private or moved).';
			} else if (e && e.status) {
				msg = 'GitHub API returned HTTP ' + e.status + '.';
			} else {
				msg = 'Could not reach GitHub API (offline, blocked or CORS).';
			}
			show('<span style="color: #a33;">' + esc(msg) + '</span>');
		});
}

function renderRepoDetails(el, d) {
	var r = d.repo;
	var rows = [];
	var row = function (k, v) { if (v !== null && v !== undefined && v !== '') { rows.push('<th style="text-align: right; color: #555; padding-right: 6px; white-space: nowrap; font-weight: normal;">' + k + '</th><td style="padding-right: 18px;">' + v + '</td>'); } };
	row('license', r.license ? esc(r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : r.license.name) : '<span style="color: #888;">none</span>');
	row('last push', r.pushed_at ? esc(r.pushed_at.substring(0, 10)) + ' <span style="color: #888;">(' + esc(timeAgo(r.pushed_at)) + ')</span>' : '');
	row('open issues + PRs', formatNum(r.open_issues_count));
	row('size', r.size >= 1024 ? (r.size / 1024).toFixed(1) + ' MB' : formatNum(r.size) + ' KB');
	row('default branch', r.default_branch ? esc(r.default_branch) : '');
	row('homepage', r.homepage && /^https?:\/\//i.test(r.homepage) ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(r.homepage) + '">' + esc(r.homepage) + '</a>' : '');
	row('status', (r.archived ? '<span style="background: #fee; color: #a33; padding: 0 4px;">archived</span> ' : '') + (r.fork && r.parent ? 'fork of ' + esc(r.parent.full_name) : ''));
	// pasek języków wg liczby bajtów
	var langs = Object.keys(d.langs || {}).map(function (k) { return [k, d.langs[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
	var total = langs.reduce(function (acc, l) { return acc + l[1]; }, 0);
	var bar = '';
	if (total > 0) {
		var top = langs.slice(0, 6), restBytes = total - top.reduce(function (acc, l) { return acc + l[1]; }, 0);
		var colorOf = function (name) { var c = (typeof LANG_COLORS !== 'undefined') ? LANG_COLORS[name] : null; return c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#bbb'; };
		var segs = top.map(function (l) { return [l[0], l[1], colorOf(l[0])]; });
		if (restBytes > 0) { segs.push(['Other', restBytes, '#ddd']); }
		bar = '<div style="display: flex; height: 8px; width: 330px; margin: 4px 0 2px 0; border-radius: 4px; overflow: hidden;">' +
			segs.map(function (g) { return '<div style="width: ' + (100 * g[1] / total).toFixed(2) + '%; background: ' + g[2] + ';" title="' + esc(g[0]) + '"></div>'; }).join('') + '</div>' +
			'<div style="font-size: 85%; color: #555;">' + segs.map(function (g) {
				return '<span style="margin-right: 10px; white-space: nowrap;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ' + g[2] + '; margin-right: 4px;"></span>' + esc(g[0]) + ' ' + (100 * g[1] / total).toFixed(1) + '%</span>';
			}).join('') + '</div>';
	}
	var q = d.quota || {};
	var foot = '<div style="font-size: 80%; color: #999; margin-top: 6px;">Live from api.github.com' +
		(q.remaining !== null && q.remaining !== undefined && q.limit ? ' &middot; ' + esc(q.remaining) + '/' + esc(q.limit) + ' anonymous requests left this hour' +
			(q.reset ? ' (resets ' + new Date(Number(q.reset) * 1000).toLocaleTimeString() + ')' : '') : '') + '</div>';
	var trs = [];
	for (var i = 0; i < rows.length; i += 2) {   // dwie pary "nazwa: wartość" w wierszu
		trs.push('<tr>' + rows[i] + (rows[i + 1] || '<th></th><td></td>') + '</tr>');
	}
	el.innerHTML = '<table>' + trs.join('') + '</table>' + bar + foot;
}

function setInfoPanel(record) {
	var panel = Ext.getCmp('info-panel');
	var html = '';
	// wiersz z tabeli filtrów (użytkownik/temat/język) nie jest repozytorium – nie ma co pokazywać
	if (record && !record.get('html_url')) {
		record = null;
	}
	if (record) {
		var url = record.get('html_url');
		globalAppURL = url;
		var link = function (text) { return '<a target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">' + text + '</a>'; };
		html += '<div style="display: flex; align-items: flex-start; gap: 12px;">';
		html += '<div style="flex: 0 0 100px;">' + (record.get('avatar_url') ? link('<img style="width: 100px;" src="' + esc(record.get('avatar_url')) + '">') : '') + '</div>';
		html += '<div style="flex: 1 1 auto; min-width: 0;">';
		html += '<table style="max-width: 100%;">' +
			'<tr><th style="text-align: right; min-width: 60px;">name</th><td>' + link('<h3 style="margin: 0;">' + esc(record.get('name')) + '</h3>') + '</td></tr>' +
			'<tr><th style="text-align: right;">desc</th><td>' + esc(record.get('desc') || '') + '</td></tr>' +
			'<tr><th style="text-align: right;">topics</th><td>' + esc(record.get('topics') || '') + '</td></tr></table>';
		html += '<div style="display: flex; flex-wrap: wrap; gap: 6px 28px; margin-top: 6px;">' +
			'<div style="min-width: 330px;"><b>Details</b><div id="repo-details" style="margin-top: 2px;"></div></div>' +
			historyHtml(record.get('ri')) + '</div>';
		html += '</div></div>';
		currentDetailsRepo = record.get('name');
	} else {
		globalAppURL = null;
		currentDetailsRepo = null;
	}
	panel.update(html);
	if (record) {
		loadRepoDetails(record.get('name'));
	}
}

function buttonClick() {
	if (globalAppURL) {
		var win = window.open(globalAppURL, '_blank');
		win.focus();
	}
}
