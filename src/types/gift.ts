export type ItemCategory = string;

export interface CatalogItem {
  id: string;
  name: string;
  category: ItemCategory;
  unitPrice: number;
}

export interface GiftLineItem {
  item: CatalogItem;
  quantity: number;
}

export interface SavedGift {
  id: string;
  title: string;
  createdAt: string;
  items: GiftLineItem[];
  laborCost: number;
  totalCost: number;
}
