package com.imobiflow.service;

import com.imobiflow.model.Property;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SupabaseService {

    @Value("${supabase.url}")
    private String supabaseUrl;

    @Value("${supabase.key}")
    private String supabaseKey;

    private final RestTemplate restTemplate = new RestTemplate();

    private HttpHeaders getHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("apikey", supabaseKey);
        headers.set("Authorization", "Bearer " + supabaseKey);
        headers.set("Content-Type", "application/json");
        headers.set("Prefer", "return=representation");
        return headers;
    }

    public List<Property> findAll() {
        try {
            String url = supabaseUrl + "/rest/v1/properties?select=*";
            HttpEntity<String> entity = new HttpEntity<>(getHeaders());
            
            ResponseEntity<Property[]> response = restTemplate.exchange(
                url, HttpMethod.GET, entity, Property[].class);
                
            return Arrays.asList(response.getBody());
        } catch (Exception e) {
            System.err.println("Erro ao buscar no Supabase: " + e.getMessage());
            throw e;
        }
    }

    public Property save(Property property) {
        String url = supabaseUrl + "/rest/v1/properties";
        try {
            if (property.getId() != null) {
                String updateUrl = url + "?id=eq." + property.getId();
                HttpEntity<Property> entity = new HttpEntity<>(property, getHeaders());
                restTemplate.exchange(updateUrl, HttpMethod.PATCH, entity, Void.class);
                return property;
            } else {
                System.out.println("Enviando para Supabase: " + property.getTitle());
                HttpEntity<Property> entity = new HttpEntity<>(property, getHeaders());
                ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);
                System.out.println("Status Supabase: " + response.getStatusCode());
                return property;
            }
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            System.err.println("Erro API Supabase: " + e.getResponseBodyAsString());
            throw new RuntimeException("Erro Supabase: " + e.getResponseBodyAsString());
        } catch (Exception e) {
            System.err.println("Erro Inesperado: " + e.getMessage());
            throw e;
        }
    }

    public Property findBySlug(String slug) {
        String url = supabaseUrl + "/rest/v1/properties?slug=eq." + slug + "&select=*";
        HttpEntity<String> entity = new HttpEntity<>(getHeaders());
        
        ResponseEntity<Property[]> response = restTemplate.exchange(
            url, HttpMethod.GET, entity, Property[].class);
            
        if (response.getBody() != null && response.getBody().length > 0) {
            return response.getBody()[0];
        }
        return null;
    }

    public void deleteById(UUID id) {
        String url = supabaseUrl + "/rest/v1/properties?id=eq." + id;
        HttpEntity<String> entity = new HttpEntity<>(getHeaders());
        restTemplate.exchange(url, HttpMethod.DELETE, entity, Void.class);
    }
}
