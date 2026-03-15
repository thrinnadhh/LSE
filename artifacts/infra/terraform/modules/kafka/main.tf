variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "tags" { type = map(string) }

resource "aws_msk_cluster" "this" {
  cluster_name           = "${var.name_prefix}-msk"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 2

  broker_node_group_info {
    instance_type   = "kafka.m5.large"
    client_subnets  = var.private_subnet_ids
    storage_info {
      ebs_storage_info {
        volume_size = 200
      }
    }
  }

  tags = var.tags
}

output "bootstrap_brokers" {
  value = aws_msk_cluster.this.bootstrap_brokers
}
