import { OrganizationModel, type IOrganization } from "../models/organization";

export const organizationRepository = {
  findById(id: string): Promise<IOrganization | null> {
    return OrganizationModel.findById(id).exec();
  },
  findBySlug(slug: string): Promise<IOrganization | null> {
    return OrganizationModel.findOne({ slug }).exec();
  },
  /**
   * Every organization, for the system-admin org picker. Capped rather than
   * unbounded — a platform admin picking a tenant needs a list, not the
   * whole table streamed into a dropdown.
   */
  listAll(limit = 500): Promise<IOrganization[]> {
    return OrganizationModel.find({}).sort({ name: 1 }).limit(limit).exec();
  },
  create(data: Partial<IOrganization>): Promise<IOrganization> {
    return OrganizationModel.create(data);
  },
  updateById(id: string, update: Partial<IOrganization>): Promise<IOrganization | null> {
    return OrganizationModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
