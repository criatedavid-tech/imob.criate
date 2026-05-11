package com.imobiflow.repository;

import com.imobiflow.model.Property;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface PropertyRepository extends JpaRepository<Property, UUID> {
    Optional<Property> findBySlug(String slug);
}
