import { OrgRoleModel, type IOrgRole } from "../models/org-role";

export const orgRoleRepository = {
  findById(id: string): Promise<IOrgRole | null> {
    return OrgRoleModel.findById(id).exec();
  },
  findByOrganizationId(organizationId: string): Promise<IOrgRole[]> {
    return OrgRoleModel.find({ organizationId }).exec();
  },
  findByIds(ids: string[]): Promise<IOrgRole[]> {
    return OrgRoleModel.find({ _id: { $in: ids } }).exec();
  },
  create(data: Partial<IOrgRole>): Promise<IOrgRole> {
    return OrgRoleModel.create(data);
  },
  updateById(id: string, update: Partial<IOrgRole>): Promise<IOrgRole | null> {
    return OrgRoleModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
