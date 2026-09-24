import { OrganizationModel, type IOrganization } from "../models/organization";

export const organizationRepository = {
  findById(id: string): Promise<IOrganization | null> {
    return OrganizationModel.findById(id).exec();
  },
  findBySlug(slug: string): Promise<IOrganization | null> {
    return OrganizationModel.findOne({ slug }).exec();
  },
  create(data: Partial<IOrganization>): Promise<IOrganization> {
    return OrganizationModel.create(data);
  },
  updateById(id: string, update: Partial<IOrganization>): Promise<IOrganization | null> {
    return OrganizationModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
