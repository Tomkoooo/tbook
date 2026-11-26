import { Types } from "mongoose";
import { DataListModel, DataListRowModel, type IDataList, type IDataListRow } from "../models/data-list";

const ROW_BATCH = 1000;

export const dataListRepository = {
  findById(id: string): Promise<IDataList | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return DataListModel.findById(id).exec();
  },
  findByOrganizationId(organizationId: string): Promise<IDataList[]> {
    return DataListModel.find({ organizationId }).sort({ name: 1 }).exec();
  },
  create(data: Partial<IDataList>): Promise<IDataList> {
    return DataListModel.create(data);
  },
  updateById(id: string, update: Partial<IDataList>): Promise<IDataList | null> {
    return DataListModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
  async deleteById(id: string): Promise<void> {
    await DataListRowModel.deleteMany({ listId: id }).exec();
    await DataListModel.deleteOne({ _id: id }).exec();
  },

  /** Replaces every row of a list (a re-upload). Rows must already have unique keys. */
  async replaceRows(organizationId: string, listId: string, rows: Array<{ key: string; data: Record<string, string> }>): Promise<number> {
    await DataListRowModel.init();
    await DataListRowModel.deleteMany({ listId }).exec();
    const orgId = new Types.ObjectId(organizationId);
    const listOid = new Types.ObjectId(listId);
    for (let i = 0; i < rows.length; i += ROW_BATCH) {
      const batch = rows.slice(i, i + ROW_BATCH).map((row) => ({ organizationId: orgId, listId: listOid, key: row.key, data: row.data }));
      await DataListRowModel.insertMany(batch, { ordered: true });
    }
    return rows.length;
  },

  /** Adds rows (keys not yet in the list) and, with `update`, overwrites the data of existing keys. Keys must be unique. */
  async appendRows(
    organizationId: string,
    listId: string,
    rows: Array<{ key: string; data: Record<string, string> }>,
    update: boolean,
  ): Promise<{ added: string[]; updated: string[]; existing: string[] }> {
    const orgId = new Types.ObjectId(organizationId);
    const listOid = new Types.ObjectId(listId);
    const present = await this.findExistingKeys(listId, rows.map((row) => row.key));
    const fresh = rows.filter((row) => !present.has(row.key));
    const existing = rows.filter((row) => present.has(row.key));
    if (fresh.length > 0) {
      await DataListRowModel.insertMany(fresh.map((row) => ({ organizationId: orgId, listId: listOid, key: row.key, data: row.data })), { ordered: true });
    }
    if (update) {
      for (const row of existing) await DataListRowModel.updateOne({ listId: listOid, key: row.key }, { $set: { data: row.data } }).exec();
    }
    const keys = existing.map((row) => row.key);
    return { added: fresh.map((row) => row.key), updated: update ? keys : [], existing: update ? [] : keys };
  },

  async deleteRow(listId: string, key: string): Promise<boolean> {
    const result = await DataListRowModel.deleteOne({ listId, key }).exec();
    return result.deletedCount > 0;
  },

  countRows(listId: string): Promise<number> {
    return DataListRowModel.countDocuments({ listId }).exec();
  },

  /** Which of these (already normalised) keys exist in the list. */
  async findExistingKeys(listId: string, keys: string[]): Promise<Set<string>> {
    if (keys.length === 0 || !Types.ObjectId.isValid(listId)) return new Set();
    const rows = await DataListRowModel.find({ listId, key: { $in: keys } }, { key: 1 }).lean().exec();
    return new Set(rows.map((row) => row.key));
  },

  findRow(listId: string, key: string): Promise<IDataListRow | null> {
    return DataListRowModel.findOne({ listId, key }).exec();
  },

  listRows(listId: string, opts: { q?: string; limit?: number; skip?: number } = {}): Promise<IDataListRow[]> {
    const filter: Record<string, unknown> = { listId };
    if (opts.q) filter.key = { $regex: `^${opts.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
    return DataListRowModel.find(filter).sort({ key: 1 }).skip(opts.skip ?? 0).limit(opts.limit ?? 50).exec();
  },

  /** Every row, as a cursor — for joins like "list rows not yet registered". */
  cursorRows(listId: string) {
    return DataListRowModel.find({ listId }).lean().cursor();
  },
};
