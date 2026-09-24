import { OrgInviteModel, type IOrgInvite } from "../models/org-invite";

export const orgInviteRepository = {
  findByTokenHash(tokenHash: string): Promise<IOrgInvite | null> {
    return OrgInviteModel.findOne({ tokenHash }).exec();
  },
  findByOrganizationAndEmail(organizationId: string, email: string): Promise<IOrgInvite[]> {
    return OrgInviteModel.find({ organizationId, email }).exec();
  },
  create(data: Partial<IOrgInvite>): Promise<IOrgInvite> {
    return OrgInviteModel.create(data);
  },
  updateById(id: string, update: Partial<IOrgInvite>): Promise<IOrgInvite | null> {
    return OrgInviteModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
