/**
 * DELIBERATE SIMPLIFICATION: uses the AWS account's existing default VPC
 * and default subnets rather than provisioning a dedicated one. Per Master
 * Plan Section 2 ("right-size before scale") and Section 3's own Stage 1
 * topology ("single region, single app instance"), building dedicated
 * networking for a 5-10 tenant pilot is complexity ahead of an actual need.
 *
 * RESOLVED: the security groups below used to allow access from anywhere
 * inside the default VPC's CIDR, because no app-hosting resource existed
 * yet to scope them to specifically (see this file's own git history).
 * Now that compute.tf's aws_security_group.app exists, Postgres/Redis are
 * scoped to it directly — nothing else in the default VPC can reach
 * either, only the one real app instance.
 */

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "postgres" {
  name        = "${var.project_name}-${var.environment}-postgres"
  description = "Allows Postgres (5432) from within the default VPC only — never from the public internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres from the app instance only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-${var.environment}-redis"
  description = "Allows Redis (6379) from within the default VPC only — never from the public internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Redis from the app instance only"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}
