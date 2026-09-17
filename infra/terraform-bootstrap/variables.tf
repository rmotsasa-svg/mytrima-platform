variable "aws_account_id" {
  description = "Same real target account as ../terraform/variables.tf — kept identical, not shared via a module, since this stack is deliberately standalone."
  type        = string
  default     = "284460774146"
}

variable "aws_region" {
  description = "Same region as ../terraform/variables.tf (af-south-1) — the state bucket/lock table live alongside what they back."
  type        = string
  default     = "af-south-1"
}

variable "project_name" {
  type    = string
  default = "mytrima"
}
