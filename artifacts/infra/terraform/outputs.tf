output "vpc_id" {
  value = module.network.vpc_id
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "redis_endpoint" {
  value = module.redis.endpoint
}

output "opensearch_endpoint" {
  value = module.opensearch.endpoint
}

output "kafka_bootstrap_brokers" {
  value = module.kafka.bootstrap_brokers
}

output "media_bucket" {
  value = module.object_storage.media_bucket
}
