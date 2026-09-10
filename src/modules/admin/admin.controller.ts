import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { PilotSummaryService } from "./pilot-summary.service";

@Controller("admin")
export class AdminController {
  constructor(private readonly pilotSummaryService: PilotSummaryService) {}

  @UseGuards(AdminApiKeyGuard)
  @Get("pilot-summary")
  getPilotSummary() {
    return this.pilotSummaryService.getSummary();
  }
}
