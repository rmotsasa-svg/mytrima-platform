import { Injectable } from "@nestjs/common";
import { StaffActivityLogEntry, StaffActivityLogStore } from "./staff-activity.service";

@Injectable()
export class InMemoryStaffActivityLogStore implements StaffActivityLogStore {
  private entries: StaffActivityLogEntry[] = [];

  async save(entry: StaffActivityLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findForTenant(tenantId: string, userId?: string): Promise<StaffActivityLogEntry[]> {
    return this.entries.filter((e) => e.tenantId === tenantId && (userId === undefined || e.userId === userId));
  }
}
