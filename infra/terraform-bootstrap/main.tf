/**
 * A separate, tiny stack whose only job is creating the S3 bucket +
 * DynamoDB lock table that ../terraform's own remote state backend needs
 * — deliberately NOT part of ../terraform itself, to avoid the exact
 * chicken-and-egg problem main.tf's own comment there names: the backend
 * needs to exist before Terraform can use it, so whatever creates it has
 * to run with local state first. This stack's own state stays local —
 * fine for something applied once, essentially never touched again.
 *
 * NOT YET APPLIED — same status as every resource in ../terraform (see
 * that directory's main.tf for why: this assistant has no real AWS
 * credentials and shouldn't be given any).
 *
 * Run this ONE apply, then follow ../terraform/README.md's own
 * "Activating this backend" section to point the main stack at what
 * gets created here.
 */

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Same real safety check as ../terraform/main.tf's own provider block —
  # see that file's comment for why.
  allowed_account_ids = [var.aws_account_id]
}
