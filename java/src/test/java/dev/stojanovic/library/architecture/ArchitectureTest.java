package dev.stojanovic.library.architecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.base.DescribedPredicate.not;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

/** The hexagonal layering, enforced: dependencies point inwards, adapters never talk to each other. */
@AnalyzeClasses(packages = "dev.stojanovic.library", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    private static final String ROOT = "dev.stojanovic.library";

    @ArchTest
    static final ArchRule layers = layeredArchitecture().consideringOnlyDependenciesInLayers()
            .layer("Domain").definedBy(ROOT + ".domain..")
            .layer("Application").definedBy(ROOT + ".application..")
            .layer("InboundAdapters").definedBy(ROOT + ".adapters.in..")
            .layer("OutboundAdapters").definedBy(ROOT + ".adapters.out..")
            .layer("Config").definedBy(ROOT + ".config..")
            .whereLayer("Config").mayNotBeAccessedByAnyLayer()
            .whereLayer("InboundAdapters").mayOnlyBeAccessedByLayers("Config")
            .whereLayer("OutboundAdapters").mayNotBeAccessedByAnyLayer()
            .whereLayer("Application").mayOnlyBeAccessedByLayers("InboundAdapters", "OutboundAdapters", "Config")
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "InboundAdapters", "OutboundAdapters",
                    "Config");

    @ArchTest
    static final ArchRule domainIsPlainJava = classes().that().resideInAPackage(ROOT + ".domain..")
            .should().onlyDependOnClassesThat().resideInAnyPackage(ROOT + ".domain..", "java..")
            .because("business rules must be testable without Spring, a database or a web server");

    @ArchTest
    static final ArchRule applicationUsesOnlyTransactionsAndStereotypesFromSpring = noClasses()
            .that().resideInAPackage(ROOT + ".application..")
            .should().dependOnClassesThat(resideInAPackage("org.springframework..")
                    .and(not(resideInAnyPackage("org.springframework.transaction..", "org.springframework.stereotype.."))))
            .orShould().dependOnClassesThat().resideInAnyPackage("jakarta.servlet..", "tools.jackson..",
                    "com.fasterxml..", "io.micrometer..", "java.sql..", "javax.sql..")
            .because("use cases talk to the outside world through ports; Spring is only used for wiring and transactions");

    @ArchTest
    static final ArchRule noCycles = slices().matching(ROOT + ".(*)..").should().beFreeOfCycles();

    @ArchTest
    static final ArchRule persistenceAdaptersAreHidden = classes()
            .that().resideInAPackage(ROOT + ".adapters.out..").and().haveSimpleNameStartingWith("Jdbc")
            .should().notBePublic()
            .because("other code must use the ports, not the JDBC implementations");
}
