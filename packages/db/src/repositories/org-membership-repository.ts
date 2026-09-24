import { OrgMembershipModel, type IOrgMembership } from "../models/org-membership";

export const orgMembershipRepository = {
  findByOrganizationAndUser(organizationId: string, userId: string): Promise<IOrgMembership | null> {
    return OrgMembershipModel.findOne({ organizationId, userId }).exec();
  },
  findByUserId(userId: string): Promise<IOrgMembership[]> {
    return OrgMembershipModel.find({ userId, status: "active" }).exec();
  },
  findByOrganizationId(organizationId: string): Promise<IOrgMembership[]> {
    return OrgMembershipModel.find({ organizationId }).exec();
  },
  create(data: Partial<IOrgMembership>): Promise<IOrgMembership> {
    return OrgMembershipModel.create(data);
  },
  updateById(id: string, update: Partial<IOrgMembership>): Promise<IOrgMembership | null> {
    return OrgMembershipModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
