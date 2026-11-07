import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Minus,
  Trash2,
  Search,
  ShoppingBag,
  Save,
  Copy,
  Check,
  PackagePlus,
  RotateCcw,
  Pencil,
  LogIn,
  LogOut,
} from 'lucide-react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { CatalogItem, GiftLineItem, ItemCategory, SavedGift } from './types/gift';
import { DEFAULT_CATALOG, LABOR_PRESETS, formatCOP } from './data/defaultCatalog';

function formatCategory(cat: string): string {
  if (!cat) return 'General';
  const clean = cat.trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const STORAGE_CATALOG_KEY = 'candy_surprise_catalog_v4';
const STORAGE_SAVED_GIFTS_KEY = 'candy_surprise_saved_gifts_v1';

type ActiveTab = 'builder' | 'catalog' | 'saved';

export default function App() {
  // Firebase Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Catalog state (synced with Firestore when signed in)
  const [catalog, setCatalog] = useState<CatalogItem[]>(DEFAULT_CATALOG);

  // Saved gifts state (synced with Firestore when signed in)
  const [savedGifts, setSavedGifts] = useState<SavedGift[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Real-time Firestore sync for catalog & savedGifts
  useEffect(() => {
    if (!authReady || !user) {
      setCatalog(DEFAULT_CATALOG);
      setSavedGifts([]);
      return;
    }

    const catalogPath = `users/${user.uid}/catalog`;
    const unsubCatalog = onSnapshot(
      collection(db, catalogPath),
      async (snapshot) => {
        if (snapshot.empty) {
          // Seed default catalog on first sign-in
          try {
            const batch = writeBatch(db);
            DEFAULT_CATALOG.forEach((item) => {
              const ref = doc(db, catalogPath, item.id);
              batch.set(ref, {
                name: item.name,
                category: item.category,
                unitPrice: item.unitPrice,
                ownerId: user.uid,
              });
            });
            await batch.commit();
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, catalogPath);
          }
          return;
        }

        const items: CatalogItem[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || ''),
            category: (data.category as ItemCategory) || 'dulce',
            unitPrice: Number(data.unitPrice) || 0,
          };
        });
        items.sort((a, b) => a.name.localeCompare(b.name));
        setCatalog(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, catalogPath);
      }
    );

    const giftsPath = `users/${user.uid}/savedGifts`;
    const unsubGifts = onSnapshot(
      collection(db, giftsPath),
      (snapshot) => {
        const gifts: SavedGift[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title || ''),
            createdAt: String(data.createdAt || ''),
            items: Array.isArray(data.items) ? (data.items as GiftLineItem[]) : [],
            laborCost: Number(data.laborCost) || 0,
            totalCost: Number(data.totalCost) || 0,
          };
        });
        setSavedGifts(gifts);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, giftsPath);
      }
    );

    return () => {
      unsubCatalog();
      unsubGifts();
    };
  }, [authReady, user]);

  // Navigation & Filter state
  const [activeTab, setActiveTab] = useState<ActiveTab>('builder');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Catalog tab specific search & filter state
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState<string>('all');

  // Current Gift Builder state
  const [giftTitle, setGiftTitle] = useState('');
  const [giftItems, setGiftItems] = useState<GiftLineItem[]>([]);
  const [laborCost, setLaborCost] = useState<number>(15000);

  // Feedback states
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // New / Edit Catalog Item form state
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<string>('Dulce');
  const [newItemPrice, setNewItemPrice] = useState('');

  // Unique categories dynamically derived from catalog + core defaults
  const allCategories = useMemo(() => {
    const defaults = ['Dulce', 'Material', 'Fruta', 'Pastel', 'Jugo', 'Desayuno'];
    const map = new Map<string, string>();
    defaults.forEach((d) => map.set(d.toLowerCase(), d));
    catalog.forEach((item) => {
      const raw = item.category?.trim();
      if (raw) {
        const lower = raw.toLowerCase();
        if (!map.has(lower)) {
          map.set(lower, formatCategory(raw));
        }
      }
    });
    return Array.from(map.values());
  }, [catalog]);

  // Filtered catalog for Gift Builder
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      const itemCat = item.category?.trim().toLowerCase() || '';
      const matchesCategory =
        categoryFilter === 'all' || itemCat === categoryFilter.toLowerCase().trim();
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        itemCat.includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [catalog, categoryFilter, searchQuery]);

  // Filtered catalog for Catalog Management Tab
  const filteredCatalogForManagement = useMemo(() => {
    return catalog.filter((item) => {
      const itemCat = item.category?.trim().toLowerCase() || '';
      const matchesCategory =
        catalogCategoryFilter === 'all' ||
        itemCat === catalogCategoryFilter.toLowerCase().trim();
      const query = catalogSearchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        itemCat.includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [catalog, catalogCategoryFilter, catalogSearchQuery]);

  // Totals calculation with per-category subtotals
  const { categorySubtotals, grandTotal, totalItemsCount } = useMemo(() => {
    const subtotals: Record<string, number> = {};
    let prodTotal = 0;
    let count = 0;

    for (const line of giftItems) {
      const lineTotal = line.item.unitPrice * line.quantity;
      const cat = formatCategory(line.item.category || 'General');
      subtotals[cat] = (subtotals[cat] || 0) + lineTotal;
      prodTotal += lineTotal;
      count += line.quantity;
    }

    return {
      categorySubtotals: subtotals,
      grandTotal: prodTotal + (Number(laborCost) || 0),
      totalItemsCount: count,
    };
  }, [giftItems, laborCost]);

  // Gift item handlers
  const getItemQuantity = (id: string): number => {
    const found = giftItems.find((line) => line.item.id === id);
    return found ? found.quantity : 0;
  };

  const handleAddItem = (item: CatalogItem) => {
    setGiftItems((prev) => {
      const existing = prev.find((line) => line.item.id === item.id);
      if (existing) {
        return prev.map((line) =>
          line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    setGiftItems((prev) =>
      prev
        .map((line) =>
          line.item.id === id ? { ...line, quantity: line.quantity + delta } : line
        )
        .filter((line) => line.quantity > 0)
    );
  };

  const handleRemoveLine = (id: string) => {
    setGiftItems((prev) => prev.filter((line) => line.item.id !== id));
  };

  const handleResetGift = () => {
    setGiftTitle('');
    setGiftItems([]);
    setLaborCost(15000);
  };

  // Save gift quote
  const handleSaveGift = async () => {
    if (giftItems.length === 0 && laborCost === 0) return;

    const giftId = `gift-${Date.now()}`;
    const newSaved: SavedGift = {
      id: giftId,
      title: giftTitle.trim() || `Regalo Personalizado #${savedGifts.length + 1}`,
      createdAt: new Date().toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      items: giftItems,
      laborCost: Number(laborCost) || 0,
      totalCost: grandTotal,
    };

    if (user) {
      const path = `users/${user.uid}/savedGifts/${giftId}`;
      try {
        await setDoc(doc(db, path), {
          title: newSaved.title,
          createdAt: newSaved.createdAt,
          items: newSaved.items,
          laborCost: newSaved.laborCost,
          totalCost: newSaved.totalCost,
          ownerId: user.uid,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    } else {
      setSavedGifts((prev) => [newSaved, ...prev]);
    }

    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleLoadSavedGift = (saved: SavedGift) => {
    setGiftTitle(saved.title);
    setGiftItems(saved.items);
    setLaborCost(saved.laborCost);
    setActiveTab('builder');
  };

  const handleDeleteSavedGift = async (id: string) => {
    if (user) {
      const path = `users/${user.uid}/savedGifts/${id}`;
      try {
        await deleteDoc(doc(db, path));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      setSavedGifts((prev) => prev.filter((g) => g.id !== id));
    }
  };

  // Copy WhatsApp-friendly summary
  const handleCopySummary = () => {
    const title = giftTitle.trim() || 'Regalo Personalizado';
    const lines = [
      `*CANDY SURPRISE CALI*`,
      `*${title}*`,
      `------------------------`,
      ...giftItems.map(
        (l) =>
          `• ${l.quantity}x ${l.item.name}: ${formatCOP(l.item.unitPrice * l.quantity)}`
      ),
      `------------------------`,
      ...Object.entries(categorySubtotals).map(
        ([cat, val]) => `Subtotal ${cat}: ${formatCOP(val)}`
      ),
      `Mano de obra: ${formatCOP(laborCost)}`,
      `*TOTAL: ${formatCOP(grandTotal)}*`,
    ];

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
  };

  // Catalog management handlers
  const handleSaveCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDigits = String(newItemPrice).replace(/\D/g, '');
    const price = parseInt(cleanDigits, 10);
    const trimmedName = newItemName.trim();
    const trimmedCategory = newItemCategory.trim() || 'General';

    if (!trimmedName || isNaN(price) || price < 0) return;

    if (editingItemId) {
      if (user) {
        const path = `users/${user.uid}/catalog/${editingItemId}`;
        try {
          await updateDoc(doc(db, path), {
            name: trimmedName,
            category: trimmedCategory,
            unitPrice: price,
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        setCatalog((prev) =>
          prev.map((item) =>
            item.id === editingItemId
              ? { ...item, name: trimmedName, category: trimmedCategory, unitPrice: price }
              : item
          )
        );
      }

      setGiftItems((prev) =>
        prev.map((line) =>
          line.item.id === editingItemId
            ? {
                ...line,
                item: {
                  ...line.item,
                  name: trimmedName,
                  category: trimmedCategory,
                  unitPrice: price,
                },
              }
            : line
        )
      );
    } else {
      const newId = `custom-${Date.now()}`;
      if (user) {
        const path = `users/${user.uid}/catalog/${newId}`;
        try {
          await setDoc(doc(db, path), {
            name: trimmedName,
            category: trimmedCategory,
            unitPrice: price,
            ownerId: user.uid,
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      } else {
        const created: CatalogItem = {
          id: newId,
          name: trimmedName,
          category: trimmedCategory,
          unitPrice: price,
        };
        setCatalog((prev) => [created, ...prev]);
      }
    }

    setNewItemName('');
    setNewItemPrice('');
    setNewItemCategory('Dulce');
    setEditingItemId(null);
    setShowNewItemForm(false);
  };

  const handleStartEditCatalogItem = (item: CatalogItem) => {
    setEditingItemId(item.id);
    setNewItemName(item.name);
    setNewItemCategory(item.category || 'Dulce');
    setNewItemPrice(String(item.unitPrice));
    setShowNewItemForm(true);
  };

  const handleDeleteCatalogItem = async (id: string) => {
    if (user) {
      const path = `users/${user.uid}/catalog/${id}`;
      try {
        await deleteDoc(doc(db, path));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      setCatalog((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Error al iniciar sesión con Google:', err);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation Bar - 3-Zone Contract */}
      <header className="bg-white border-b-2 border-slate-200 px-6 py-4 no-print">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-8">
          {/* Zone 1: Brand Logo & Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('builder');
            }}
            className="flex items-center gap-4 whitespace-nowrap shrink-0"
          >
            <img
              src="/assets/aistudio/image_966b29a3.png"
              alt="Logo Candy Surprise Cali"
              referrerPolicy="no-referrer"
              className="h-14 w-auto object-contain"
            />
            <span className="text-2xl font-extrabold tracking-tight text-slate-900">
              Candy Surprise Cali
            </span>
          </a>

          {/* Zone 2: Navigation Links */}
          <nav className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('builder')}
              className={`min-h-[50px] px-5 py-2.5 rounded-xl text-lg font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'builder'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              Armar Regalo
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('catalog')}
              className={`min-h-[50px] px-5 py-2.5 rounded-xl text-lg font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'catalog'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              Catálogo ({catalog.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('saved')}
              className={`min-h-[50px] px-5 py-2.5 rounded-xl text-lg font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'saved'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              Guardados ({savedGifts.length})
            </button>
          </nav>

          {/* Zone 3: Primary Action & Google Sync */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                title={`Conectado como ${user.email}`}
                className="min-h-[50px] px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-base font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-5 h-5" />
                <span>{user.email?.split('@')[0]}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="min-h-[50px] px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-base font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="w-5 h-5" />
                <span>Conectar Gmail</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleResetGift}
              className="min-h-[50px] px-5 py-2.5 rounded-xl border-2 border-slate-800 bg-white hover:bg-slate-100 text-slate-900 text-lg font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-5 h-5" />
              <span>Nuevo Regalo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {activeTab === 'builder' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Catalog Selection (7 cols) */}
            <section className="lg:col-span-7 space-y-6">
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h1 className="text-2xl font-extrabold text-slate-900">
                    1. Elige Dulces y Materiales
                  </h1>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingItemId(null);
                      setNewItemName('');
                      setNewItemPrice('');
                      setNewItemCategory('Dulce');
                      setShowNewItemForm((prev) => !prev);
                    }}
                    className="min-h-[48px] px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-base font-bold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <PackagePlus className="w-5 h-5" />
                    <span>Agregar Nuevo Producto</span>
                  </button>
                </div>

                {/* Quick Add New Product Form */}
                {showNewItemForm && (
                  <form
                    onSubmit={handleSaveCatalogItem}
                    className="bg-slate-100 border-2 border-slate-300 rounded-xl p-5 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-slate-900">
                        {editingItemId ? 'Editar Producto' : 'Nuevo Producto'}
                      </h2>
                      <span className="text-sm font-semibold text-slate-600">
                        Cualquier categoría y precio
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-base font-bold text-slate-800 mb-1">
                          Nombre del producto
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Ej: Chocolatina Kinder, Peluche Oso, etc."
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          className="w-full min-h-[50px] px-4 rounded-xl border-2 border-slate-400 bg-white text-lg font-medium text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-base font-bold text-slate-800 mb-1">
                          Precio ($)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          required
                          placeholder="Ej: 5500"
                          value={newItemPrice}
                          onChange={(e) => setNewItemPrice(e.target.value)}
                          className="w-full min-h-[50px] px-4 rounded-xl border-2 border-slate-400 bg-white text-lg font-bold font-mono-tabular text-slate-900"
                        />
                        {newItemPrice && !isNaN(parseInt(newItemPrice.replace(/\D/g, ''), 10)) && (
                          <p className="text-sm font-bold text-emerald-700 mt-1">
                            Valor: {formatCOP(parseInt(newItemPrice.replace(/\D/g, ''), 10))}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Free Category Input + Suggestion Chips */}
                    <div className="space-y-2">
                      <label className="block text-base font-bold text-slate-800">
                        Categoría del producto (puedes escribir cualquier categoría)
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Escribe la categoría (ej: Dulce, Material, Peluche, Globo, Licor...)"
                        value={newItemCategory}
                        onChange={(e) => setNewItemCategory(e.target.value)}
                        className="w-full min-h-[50px] px-4 rounded-xl border-2 border-slate-400 bg-white text-lg font-medium text-slate-900"
                      />
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-sm font-semibold text-slate-600">Sugerencias:</span>
                        {allCategories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setNewItemCategory(cat)}
                            className={`min-h-[38px] px-3.5 rounded-lg text-sm font-bold border-2 transition-colors cursor-pointer ${
                              newItemCategory.toLowerCase().trim() === cat.toLowerCase().trim()
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowNewItemForm(false)}
                        className="min-h-[48px] px-5 rounded-xl border-2 border-slate-400 bg-white text-slate-800 text-lg font-bold cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="min-h-[48px] px-6 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-lg font-bold cursor-pointer"
                      >
                        Guardar
                      </button>
                    </div>
                  </form>
                )}

                {/* Search & Dynamic Category Filter */}
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="w-6 h-6 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre o categoría..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full min-h-[54px] pl-12 pr-4 rounded-xl border-2 border-slate-300 bg-slate-50 focus:bg-white text-lg font-medium text-slate-900"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      onClick={() => setCategoryFilter('all')}
                      className={`min-h-[46px] px-5 rounded-xl text-base font-bold transition-colors cursor-pointer ${
                        categoryFilter === 'all'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      Todos ({catalog.length})
                    </button>
                    {allCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`min-h-[46px] px-4 rounded-xl text-base font-bold transition-colors cursor-pointer ${
                          categoryFilter.toLowerCase().trim() === cat.toLowerCase().trim()
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Product Grid */}
                {filteredCatalog.length === 0 ? (
                  <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                    <p className="text-xl font-bold text-slate-700">
                      No se encontraron productos
                    </p>
                    <p className="text-base text-slate-600 mt-1">
                      Intenta con otra búsqueda o agrega un nuevo producto.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredCatalog.map((item) => {
                      const qty = getItemQuantity(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`p-5 rounded-2xl border-2 flex flex-col justify-between gap-4 transition-colors ${
                            qty > 0
                              ? 'border-rose-700 bg-rose-50/40'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div>
                            <span className="text-sm font-bold uppercase tracking-wide text-slate-500">
                              {formatCategory(item.category)}
                            </span>
                            <h3 className="text-xl font-extrabold text-slate-900 mt-0.5 leading-snug">
                              {item.name}
                            </h3>
                            <p className="text-2xl font-extrabold font-mono-tabular text-slate-900 mt-2">
                              {formatCOP(item.unitPrice)}
                            </p>
                          </div>

                          {qty === 0 ? (
                            <button
                              type="button"
                              onClick={() => handleAddItem(item)}
                              className="min-h-[52px] w-full rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-lg font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                            >
                              <Plus className="w-6 h-6" />
                              <span>Agregar</span>
                            </button>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                aria-label={`Quitar uno de ${item.name}`}
                                onClick={() => handleUpdateQuantity(item.id, -1)}
                                className="w-14 h-14 rounded-xl border-2 border-slate-900 bg-white hover:bg-slate-100 text-slate-900 flex items-center justify-center cursor-pointer"
                              >
                                <Minus className="w-6 h-6" />
                              </button>
                              <span className="text-2xl font-extrabold font-mono-tabular text-slate-900 px-3">
                                {qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`Agregar uno más de ${item.name}`}
                                onClick={() => handleUpdateQuantity(item.id, 1)}
                                className="w-14 h-14 rounded-xl bg-rose-700 hover:bg-rose-800 text-white flex items-center justify-center cursor-pointer"
                              >
                                <Plus className="w-6 h-6" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Right Column: Gift Summary & Labor Cost (5 cols) */}
            <aside className="lg:col-span-5 bg-white border-2 border-slate-300 rounded-2xl p-6 space-y-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
              <div className="flex items-center justify-between border-b-2 border-slate-200 pb-4">
                <div className="flex items-center gap-3">
                  <ShoppingBag className="w-7 h-7 text-rose-700" />
                  <h2 className="text-2xl font-extrabold text-slate-900">
                    2. Tu Regalo ({totalItemsCount})
                  </h2>
                </div>
              </div>

              {/* Gift Name / Customer */}
              <div>
                <label
                  htmlFor="gift-title"
                  className="block text-base font-bold text-slate-800 mb-1.5"
                >
                  Nombre del regalo o cliente (opcional)
                </label>
                <input
                  id="gift-title"
                  type="text"
                  placeholder="Ej: Ancheta Cumpleaños Ana"
                  value={giftTitle}
                  onChange={(e) => setGiftTitle(e.target.value)}
                  className="w-full min-h-[52px] px-4 rounded-xl border-2 border-slate-300 bg-slate-50 focus:bg-white text-lg font-medium text-slate-900"
                />
              </div>

              {/* Selected Items List */}
              {giftItems.length === 0 ? (
                <div className="py-10 px-4 text-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                  <p className="text-xl font-bold text-slate-700">
                    El regalo está vacío
                  </p>
                  <p className="text-base text-slate-600 mt-1">
                    Toca el botón rojo <strong>Agregar</strong> en los dulces o materiales de la izquierda.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {giftItems.map(({ item, quantity }) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50 flex flex-col gap-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-slate-900 leading-snug">
                            {item.name}
                          </h4>
                          <p className="text-base text-slate-600 font-mono-tabular">
                            {formatCOP(item.unitPrice)} c/u
                          </p>
                        </div>
                        <p className="text-xl font-extrabold font-mono-tabular text-slate-900 shrink-0">
                          {formatCOP(item.unitPrice * quantity)}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Disminuir ${item.name}`}
                            onClick={() => handleUpdateQuantity(item.id, -1)}
                            className="w-11 h-11 rounded-lg border-2 border-slate-800 bg-white hover:bg-slate-100 text-slate-900 flex items-center justify-center cursor-pointer"
                          >
                            <Minus className="w-5 h-5" />
                          </button>
                          <span className="text-xl font-extrabold font-mono-tabular px-3">
                            {quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Aumentar ${item.name}`}
                            onClick={() => handleUpdateQuantity(item.id, 1)}
                            className="w-11 h-11 rounded-lg border-2 border-slate-800 bg-white hover:bg-slate-100 text-slate-900 flex items-center justify-center cursor-pointer"
                          >
                            <Plus className="w-5 h-5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveLine(item.id)}
                          className="min-h-[44px] px-3 rounded-lg text-rose-700 hover:bg-rose-100 font-bold text-base flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-5 h-5" />
                          <span>Quitar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Mano de Obra (Labor Cost) */}
              <div className="border-t-2 border-slate-200 pt-5 space-y-3">
                <label
                  htmlFor="labor-cost"
                  className="block text-xl font-extrabold text-slate-900"
                >
                  Valor por Mano de Obra ($)
                </label>
                <input
                  id="labor-cost"
                  type="number"
                  min="0"
                  step="1000"
                  value={laborCost}
                  onChange={(e) => setLaborCost(Math.max(0, Number(e.target.value)))}
                  className="w-full min-h-[56px] px-4 rounded-xl border-2 border-slate-400 bg-white text-2xl font-extrabold font-mono-tabular text-slate-900"
                />
                <div className="flex flex-wrap gap-2">
                  {LABOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setLaborCost(preset)}
                      className={`min-h-[44px] px-3.5 rounded-lg text-base font-bold font-mono-tabular border-2 transition-colors cursor-pointer ${
                        laborCost === preset
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {formatCOP(preset)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subtotals & Grand Total */}
              <div className="border-t-2 border-slate-200 pt-5 space-y-2.5 text-lg">
                {Object.keys(categorySubtotals).length === 0 ? (
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Subtotal Productos:</span>
                    <span className="font-mono-tabular font-bold text-slate-700">
                      {formatCOP(0)}
                    </span>
                  </div>
                ) : (
                  Object.entries(categorySubtotals).map(([catName, val]) => (
                    <div key={catName} className="flex justify-between text-slate-700 font-semibold">
                      <span>Subtotal {catName}:</span>
                      <span className="font-mono-tabular font-bold text-slate-900">
                        {formatCOP(val)}
                      </span>
                    </div>
                  ))
                )}
                <div className="flex justify-between text-slate-700 font-semibold">
                  <span>Mano de Obra:</span>
                  <span className="font-mono-tabular font-bold text-slate-900">
                    {formatCOP(laborCost)}
                  </span>
                </div>

                <div className="mt-4 p-5 rounded-2xl bg-slate-900 text-white flex items-center justify-between">
                  <span className="text-xl font-extrabold uppercase tracking-wide">
                    Total Regalo
                  </span>
                  <span className="text-3xl sm:text-4xl font-extrabold font-mono-tabular">
                    {formatCOP(grandTotal)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 no-print">
                <button
                  type="button"
                  onClick={handleSaveGift}
                  disabled={giftItems.length === 0}
                  className="min-h-[56px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white text-lg font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {savedNotice ? <Check className="w-6 h-6" /> : <Save className="w-6 h-6" />}
                  <span>{savedNotice ? '¡Guardado!' : 'Guardar Regalo'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopySummary}
                  disabled={giftItems.length === 0}
                  className="min-h-[56px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 text-white text-lg font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {copiedSummary ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                  <span>{copiedSummary ? '¡Copiado!' : 'Copiar Resumen'}</span>
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Catalog Management Tab */}
        {activeTab === 'catalog' && (
          <section className="bg-white border-2 border-slate-200 rounded-2xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">
                  Catálogo de Dulces y Materiales
                </h1>
                <p className="text-lg text-slate-600">
                  Aquí puedes buscar, agregar, editar o eliminar productos y sus precios.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingItemId(null);
                  setNewItemName('');
                  setNewItemPrice('');
                  setNewItemCategory('Dulce');
                  setShowNewItemForm((prev) => !prev);
                }}
                className="min-h-[52px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-lg font-bold flex items-center gap-2 cursor-pointer"
              >
                <PackagePlus className="w-6 h-6" />
                <span>Nuevo Producto</span>
              </button>
            </div>

            {/* Edit / New Product Form */}
            {showNewItemForm && (
              <form
                onSubmit={handleSaveCatalogItem}
                className="bg-slate-100 border-2 border-slate-300 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-900">
                    {editingItemId ? 'Editar Producto' : 'Nuevo Producto'}
                  </h2>
                  <span className="text-sm font-semibold text-slate-600">
                    Cualquier categoría y precio
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-base font-bold text-slate-800 mb-1">
                      Nombre del producto
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Chocolatina Kinder, Peluche Oso, etc."
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      className="w-full min-h-[50px] px-4 rounded-xl border-2 border-slate-400 bg-white text-lg font-medium text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-bold text-slate-800 mb-1">
                      Precio ($)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      placeholder="Ej: 5500"
                      value={newItemPrice}
                      onChange={(e) => setNewItemPrice(e.target.value)}
                      className="w-full min-h-[50px] px-4 rounded-xl border-2 border-slate-400 bg-white text-lg font-bold font-mono-tabular text-slate-900"
                    />
                    {newItemPrice && !isNaN(parseInt(newItemPrice.replace(/\D/g, ''), 10)) && (
                      <p className="text-sm font-bold text-emerald-700 mt-1">
                        Valor: {formatCOP(parseInt(newItemPrice.replace(/\D/g, ''), 10))}
                      </p>
                    )}
                  </div>
                </div>

                {/* Free Category Input + Suggestion Chips */}
                <div className="space-y-2">
                  <label className="block text-base font-bold text-slate-800">
                    Categoría del producto (puedes escribir cualquier categoría)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Escribe la categoría (ej: Dulce, Material, Peluche, Globo, Licor...)"
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value)}
                    className="w-full min-h-[50px] px-4 rounded-xl border-2 border-slate-400 bg-white text-lg font-medium text-slate-900"
                  />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-sm font-semibold text-slate-600">Sugerencias:</span>
                    {allCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setNewItemCategory(cat)}
                        className={`min-h-[38px] px-3.5 rounded-lg text-sm font-bold border-2 transition-colors cursor-pointer ${
                          newItemCategory.toLowerCase().trim() === cat.toLowerCase().trim()
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNewItemForm(false)}
                    className="min-h-[48px] px-5 rounded-xl border-2 border-slate-400 bg-white text-slate-800 text-lg font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="min-h-[48px] px-6 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-lg font-bold cursor-pointer"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            )}

            {/* Buscador de productos en el Catálogo */}
            <div className="space-y-4 pt-2">
              <div className="relative">
                <Search className="w-6 h-6 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar producto en el catálogo por nombre o categoría..."
                  value={catalogSearchQuery}
                  onChange={(e) => setCatalogSearchQuery(e.target.value)}
                  className="w-full min-h-[54px] pl-12 pr-4 rounded-xl border-2 border-slate-300 bg-slate-50 focus:bg-white text-lg font-medium text-slate-900"
                />
              </div>

              {/* Filtros por Categoría en Catálogo */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCatalogCategoryFilter('all')}
                  className={`min-h-[46px] px-5 rounded-xl text-base font-bold transition-colors cursor-pointer ${
                    catalogCategoryFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                >
                  Todas ({catalog.length})
                </button>
                {allCategories.map((cat) => {
                  const count = catalog.filter(
                    (i) => i.category?.toLowerCase().trim() === cat.toLowerCase().trim()
                  ).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCatalogCategoryFilter(cat)}
                      className={`min-h-[46px] px-4 rounded-xl text-base font-bold transition-colors cursor-pointer ${
                        catalogCategoryFilter.toLowerCase().trim() === cat.toLowerCase().trim()
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-base font-semibold text-slate-600 px-1">
                <span>
                  Mostrando {filteredCatalogForManagement.length} de {catalog.length} productos
                </span>
                {(catalogSearchQuery || catalogCategoryFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setCatalogSearchQuery('');
                      setCatalogCategoryFilter('all');
                    }}
                    className="text-blue-700 hover:underline font-bold cursor-pointer"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>

            {/* Listado filtrado del Catálogo */}
            {filteredCatalogForManagement.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300 space-y-3">
                <p className="text-xl font-bold text-slate-700">
                  No se encontraron productos en el catálogo
                </p>
                <p className="text-base text-slate-600">
                  No hay productos que coincidan con la búsqueda "{catalogSearchQuery}".
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCatalogSearchQuery('');
                    setCatalogCategoryFilter('all');
                  }}
                  className="min-h-[46px] px-5 rounded-xl bg-slate-900 text-white font-bold text-base cursor-pointer"
                >
                  Ver todos los productos
                </button>
              </div>
            ) : (
              <div className="divide-y-2 divide-slate-200 border-2 border-slate-200 rounded-xl overflow-hidden">
                {filteredCatalogForManagement.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 sm:p-5 bg-white flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                  >
                    <div>
                      <span className="text-sm font-bold uppercase tracking-wide text-slate-500">
                        {formatCategory(item.category)}
                      </span>
                      <h3 className="text-xl font-bold text-slate-900 mt-0.5">{item.name}</h3>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-extrabold font-mono-tabular text-slate-900">
                        {formatCOP(item.unitPrice)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleStartEditCatalogItem(item)}
                        className="min-h-[46px] px-4 rounded-xl border-2 border-slate-800 bg-white hover:bg-slate-100 text-slate-900 font-bold text-base flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCatalogItem(item.id)}
                        className="min-h-[46px] px-4 rounded-xl border-2 border-rose-700 text-rose-700 hover:bg-rose-50 font-bold text-base flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Saved Gifts Tab */}
        {activeTab === 'saved' && (
          <section className="bg-white border-2 border-slate-200 rounded-2xl p-6 space-y-6">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">
                Regalos Guardados
              </h1>
              <p className="text-lg text-slate-600">
                Cotizaciones y regalos armados anteriormente.
              </p>
            </div>

            {savedGifts.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                <p className="text-xl font-bold text-slate-700">
                  Aún no hay regalos guardados
                </p>
                <p className="text-base text-slate-600 mt-1">
                  Arma un regalo y presiona <strong>Guardar Regalo</strong> para verlo aquí.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {savedGifts.map((gift) => (
                  <div
                    key={gift.id}
                    className="p-6 rounded-2xl border-2 border-slate-300 bg-slate-50 flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-2xl font-extrabold text-slate-900">
                          {gift.title}
                        </h3>
                        <span className="text-2xl font-extrabold font-mono-tabular text-rose-700">
                          {formatCOP(gift.totalCost)}
                        </span>
                      </div>
                      <p className="text-base text-slate-600 mt-1">{gift.createdAt}</p>
                      <ul className="mt-4 space-y-1.5 text-base text-slate-800">
                        {gift.items.map((line) => (
                          <li key={line.item.id} className="flex justify-between">
                            <span>
                              {line.quantity}x {line.item.name}
                            </span>
                            <span className="font-mono-tabular font-semibold">
                              {formatCOP(line.item.unitPrice * line.quantity)}
                            </span>
                          </li>
                        ))}
                        <li className="flex justify-between text-slate-600 pt-1 border-t border-slate-300">
                          <span>Mano de obra</span>
                          <span className="font-mono-tabular font-semibold">
                            {formatCOP(gift.laborCost)}
                          </span>
                        </li>
                      </ul>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => handleLoadSavedGift(gift)}
                        className="flex-1 min-h-[50px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-lg font-bold cursor-pointer"
                      >
                        Cargar en Armador
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedGift(gift.id)}
                        className="min-h-[50px] px-4 rounded-xl border-2 border-rose-700 text-rose-700 hover:bg-rose-50 text-lg font-bold cursor-pointer"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
