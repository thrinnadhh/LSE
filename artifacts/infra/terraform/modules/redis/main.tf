variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "node_type" { type = string }
variable "tags" { type = map(string) }

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis-subnets"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${var.name_prefix}-redis"
  description                = "Redis cluster for ${var.name_prefix}"
  node_type                  = var.node_type
  num_cache_clusters         = 2
  engine                     = "redis"
  engine_version             = "7.0"
  automatic_failover_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  tags = var.tags
}

output "endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}
