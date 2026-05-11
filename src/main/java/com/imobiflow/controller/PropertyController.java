package com.imobiflow.controller;

import com.imobiflow.model.Property;
import com.imobiflow.repository.PropertyRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.client.RestTemplate;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/properties")
@CrossOrigin(origins = "*")
public class PropertyController {

    @Autowired
    private com.imobiflow.service.SupabaseService supabaseService;

    @Autowired
    private PropertyRepository repository;

    @GetMapping
    public List<Property> getAllProperties() {
        try {
            return supabaseService.findAll();
        } catch (Exception e) {
            System.err.println("Erro ao buscar no Supabase API, tentando H2: " + e.getMessage());
            return repository.findAll();
        }
    }

    @GetMapping("/{slug}")
    public ResponseEntity<Property> getPropertyBySlug(@PathVariable String slug) {
        try {
            Property p = supabaseService.findBySlug(slug);
            if (p != null) return ResponseEntity.ok(p);
        } catch (Exception e) {
            System.err.println("Erro ao buscar slug no Supabase API: " + e.getMessage());
        }
        return repository.findBySlug(slug)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Property> saveProperty(@RequestBody Property property) {
        System.out.println("Recebendo requisição para salvar imóvel: " + property.getTitle());
        
        if (property.getSlug() == null || property.getSlug().isEmpty()) {
            String slugBase = property.getTitle().toLowerCase()
                    .replaceAll("[^a-z0-9]", "-")
                    .replaceAll("-+", "-")
                    .replaceAll("^-|-$", "");
            property.setSlug(slugBase + "-" + UUID.randomUUID().toString().substring(0, 4));
        }
        
        try {
            Property saved = supabaseService.save(property);
            System.out.println("Imóvel salvo no Supabase (via API): " + saved.getId());
            return ResponseEntity.ok(saved);
        } catch (Exception e) {
            System.err.println("Erro ao salvar no Supabase API, salvando no H2: " + e.getMessage());
            Property saved = repository.save(property);
            return ResponseEntity.ok(saved);
        }
    }

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> status = new HashMap<>();
        status.put("status", "UP");
        
        try {
            supabaseService.findAll();
            status.put("database", "CONNECTED");
            status.put("supabase_api", "CONNECTED");
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            status.put("database", "ERROR");
            if (e.getStatusCode().value() == 404) {
                status.put("db_error", "Tabela 'properties' nao encontrada no Supabase. Crie-a no SQL Editor.");
            } else {
                status.put("db_error", "Erro API Supabase: " + e.getStatusCode());
            }
            status.put("supabase_api", "ERROR");
        } catch (Exception e) {
            status.put("database", "ERROR");
            status.put("db_error", e.getMessage());
            status.put("supabase_api", "ERROR");
        }

        try {
            jdbcTemplate.execute("SELECT 1");
            status.put("local_h2", "CONNECTED");
        } catch (Exception e) {
            status.put("local_h2", "DISCONNECTED");
        }
        
        status.put("message", "Java Backend via Supabase API");
        return status;
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProperty(@PathVariable UUID id) {
        try {
            supabaseService.deleteById(id);
        } catch (Exception e) {
            repository.deleteById(id);
        }
        return ResponseEntity.ok().build();
    }
}
